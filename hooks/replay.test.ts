import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import type { View } from '../types'
import { toDisplay } from './display'
import { feed, initialState } from './partial'
import { watcher } from './register'

// 실제 크기 조각열(Write 3000줄, 조각 평균 20자)을 관찰부 켬·끔으로 돌려 흐름을 늦추지 않는다는 기준과 대조한다.
// 기준: 엔진 거친 조각당 p95가 끔 대비 +0.1ms 안쪽, $.state set 횟수 ≤ 표시가 바뀐 조각 수,
// 멈춘 흐름에서도 마지막 글자가 33ms 안에 set된다.
const LINES = 3000
const WORD_CHUNKS = 2000
const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'test-model', messageCount: 1 }
const RESULT: TurnStepResult = { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
const out = (globalThis as unknown as { console: { log: (line: string) => void } }).console

function writeChunks(): TurnStepChunk[] {
  const lines: string[] = []
  for (let i = 0; i < LINES; i++) lines.push(`  const value${i} = compute(${i}, "줄 ${i}") // 설명\t${i % 7}`)
  const json = JSON.stringify({ file_path: '/tmp/replay.ts', content: `${lines.join('\n')}\n` })
  // 생각·답 조각 2000개를 섞는다(각 20자).
  const words = Array.from({ length: WORD_CHUNKS }, (_, i): TurnStepChunk => ({ kind: i < WORD_CHUNKS / 2 ? 'thinking' : 'text', index: i < WORD_CHUNKS / 2 ? 0 : 1, text: `생각과 답 조각 ${i % 10}번째입니다. ` }))
  const chunks: TurnStepChunk[] = [...words, { kind: 'tool', index: 2, id: 'call-0', name: 'Write' }]
  let seed = 17
  for (let i = 0; i < json.length; ) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const size = 1 + (seed % 39) // 1~39자, 평균 20자
    chunks.push({ kind: 'input', index: 2, json: json.slice(i, i + size) })
    i += size
  }
  return chunks
}

// 관찰부와 무관하게 센 "표시가 바뀐 조각 수": 머리 줄이 처음 생긴 tool 조각 + 머리·본문 표시가 달라진 input 조각.
function changedChunks(chunks: readonly TurnStepChunk[]): number {
  let state = initialState()
  let shown = ''
  let count = 1
  for (const chunk of chunks) {
    // 생각·답 조각은 하나하나가 표시를 바꾼다.
    if (chunk.kind === 'text' || chunk.kind === 'thinking') count++
    if (chunk.kind !== 'input') continue
    state = feed(state, chunk.json)
    const next = `${state.values.file_path ?? ''}\u0000${toDisplay(state.values.content ?? '')}`
    if (next !== shown) count++
    shown = next
  }
  return count
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

const summary = (times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b)
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0 }
}

const ms = (value: number) => value.toFixed(4)

test('replay: 관찰부만 따로 잰 시간과 set 횟수', async () => {
  const chunks = writeChunks()
  let sets = 0
  const fake = {
    ui: {
      panes: async () => [{ id: 'live', title: '코딩 뷰어', isShown: true, isFocused: false, isPlaced: true }],
      log: () => undefined,
      scroll: async () => ({}),
    },
    clock: { after: () => ({ cancel: () => undefined }) },
    // HOME이 없으면 상태 파일은 쓰지 않고 그만둔다.
    env: { get: async () => undefined },
    state: {
      set: async () => {
        sets++
        return { isSet: true, version: sets }
      },
    },
  } as unknown as EngineInterface
  const observe = watcher(fake)
  const on: number[] = []
  const off: number[] = []
  for (const chunk of chunks) {
    let started = performance.now()
    observe(chunk)
    on.push(performance.now() - started)
    started = performance.now()
    off.push(performance.now() - started)
    // 실제 흐름처럼 조각 사이에 기다리던 $ 호출이 풀린다.
    await Promise.resolve()
  }
  const changed = changedChunks(chunks)
  const onStats = summary(on)
  const offStats = summary(off)
  out.log(
    `replay 관찰부: 조각 ${chunks.length}개, 켬 p50 ${ms(onStats.p50)} p95 ${ms(onStats.p95)} 최대 ${ms(onStats.max)}ms / ` +
      `끔 p95 ${ms(offStats.p95)} 최대 ${ms(offStats.max)}ms / set ${sets}회, 표시가 바뀐 조각 ${changed}개`,
  )
  expect(onStats.p95).toBeLessThan(1)
  expect(sets).toBeLessThanOrEqual(changed)
  expect(sets).toBeGreaterThan(0)
})

test('replay: 엔진을 거친 조각당 시간, 켬(본 단계)·끔(하위 에이전트 단계는 그냥 넘긴다)', { timeoutMs: 120000 }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const chunks = writeChunks()
  let sets = 0
  on('turn.step', async function* () {
    for (const chunk of chunks) yield chunk
    return RESULT
  })
  on('ui.panes', async () => ({ value: [{ id: 'live', title: '코딩 뷰어', isShown: true, isFocused: false, isPlaced: true }] }))
  on('state.set', (_engine, e, next) => {
    sets++
    return next(e)
  })
  const run = async (input: TurnStepInput) => {
    const gaps: number[] = []
    const iterator = $.turn.step(input)[Symbol.asyncIterator]()
    let last = performance.now()
    for (let step = await iterator.next(); !step.done; step = await iterator.next()) {
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }
    await clock.settle()
    return summary(gaps)
  }
  const offStats = await run({ ...STEP, agentId: 'agent-1' })
  const onStats = await run(STEP)
  out.log(
    `replay 엔진 경유: 조각 ${chunks.length}개, 켬 p50 ${ms(onStats.p50)} p95 ${ms(onStats.p95)} 최대 ${ms(onStats.max)}ms / ` +
      `끔 p50 ${ms(offStats.p50)} p95 ${ms(offStats.p95)} 최대 ${ms(offStats.max)}ms / set ${sets}회`,
  )
  expect(onStats.p95).toBeLessThan(offStats.p95 + 0.1)
  expect(sets).toBeLessThanOrEqual(changedChunks(chunks))
})

test('replay: 쓰다 멈춘 흐름에서도 마지막 글자가 33ms 안에 set된다', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const sent: string[] = []
  const body = 'x'.repeat(200)
  const chunks: TurnStepChunk[] = [
    { kind: 'tool', index: 0, id: 'call-0', name: 'Write' },
    { kind: 'input', index: 0, json: '{"file_path":"/tmp/stall.ts","content":"' },
    ...Array.from({ length: body.length / 10 }, (_, i): TurnStepChunk => ({ kind: 'input', index: 0, json: body.slice(i * 10, i * 10 + 10) })),
  ]
  on('turn.step', async function* () {
    for (const chunk of chunks) yield chunk
    // 모델이 쓰다 1초 멈춘다.
    await clock.sleep(1000)
    yield { kind: 'input', index: 0, json: '"}' }
    return RESULT
  })
  on('ui.panes', async () => ({ value: [{ id: 'live', title: '코딩 뷰어', isShown: true, isFocused: false, isPlaced: true }] }))
  on('state.set', (_engine, e, next) => {
    const latest = (e.value as View).items.at(-1)
    sent.push(latest?.type === 'box' ? latest.shown.source : '')
    return next(e)
  })
  const iterator = $.turn.step(STEP)[Symbol.asyncIterator]()
  for (let i = 0; i < chunks.length; i++) await iterator.next()
  const finished = iterator.next().then(async step => (step.done ? step : iterator.next()))
  await clock.settle()
  await clock.advance(33)
  out.log(`replay 멈춤: 조각 ${chunks.length}개 뒤 멈춤, 33ms 안에 set ${sent.length}회, 마지막 본문 ${sent.at(-1)?.length}자`)
  expect(sent.at(-1)).toBe(body)
  await clock.advance(1000)
  expect((await finished).done).toBe(true)
})
