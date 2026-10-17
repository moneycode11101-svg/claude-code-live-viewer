import { expect, mock, test } from 'claude-code/testing'
import type { TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import type { View } from '../types'

// 끄기는 모듈마다 한 번이라 register.test.ts와 따로 둔다: $.ui.log까지 던질 때.
const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'test-model', messageCount: 1 }
const RESULT: TurnStepResult = { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
const CHUNKS: TurnStepChunk[] = [
  { kind: 'tool', index: 0, id: 'call-0', name: 'Edit' },
  { kind: 'input', index: 0, json: '{"file_path":"/tmp/a.ts","new_string":"x' },
  { kind: 'input', index: 0, json: 'y"}' },
]

test('패널 목록과 $.ui.log가 모두 던져도 조각·결과는 그대로이고 관찰은 꺼진다', async ($, on) => {
  const clock = mock.clock(on)
  const sets: View[] = []
  on('turn.step', async function* () {
    for (const chunk of CHUNKS) yield chunk
    return RESULT
  })
  on('ui.panes', () => {
    throw new Error('패널 목록 실패')
  })
  on('ui.log', () => {
    throw new Error('로그 실패')
  })
  on('state.set', (_engine, e, next) => {
    sets.push(e.value as View)
    return next(e)
  })
  let firstRound = 0
  for (let round = 0; round < 2; round++) {
    // 시험 키트의 맨 위 stream.result는 비어 오므로 결과는 생성기의 반환값으로 받는다.
    const got: TurnStepChunk[] = []
    const iterator = $.turn.step(STEP)[Symbol.asyncIterator]()
    let step = await iterator.next()
    for (; !step.done; step = await iterator.next()) got.push(step.value)
    expect(got).toEqual(CHUNKS)
    expect(step.value).toEqual(RESULT)
    await clock.settle()
    if (round === 0) firstRound = sets.length
  }
  // 마지막으로 쓴 것은 끈 표시이고, 두 번째 단계는 관찰하지 않는다.
  expect(sets.at(-1)?.isOff).toBe(true)
  expect(sets.length).toBe(firstRound)
})
