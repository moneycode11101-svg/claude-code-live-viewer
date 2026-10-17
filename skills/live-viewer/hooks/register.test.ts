import { expect, mock, test } from 'claude-code/testing'
import type { HookStream, On, RenderElement, TurnStepChunk, TurnStepInput, TurnStepResult, UiOpenResult, UiPane } from 'claude-code'

import type { View } from '../types'

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'test-model', messageCount: 1 }
const RESULT: TurnStepResult = { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
const PLACED: UiPane = { id: 'live', title: '코딩 뷰어', isShown: true, isFocused: false, isPlaced: true }
const UNPLACED: UiPane = { ...PLACED, isPlaced: false }
const PANE_PROPS = { title: '코딩 뷰어', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const
const SPINNER_PROPS = { word: 'Working', message: null, suffix: '', mode: 'tool-input' } as const
const SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const

type World = { sets: View[]; opens: number; titles: string[]; closes: string[]; writes: string[]; nextCalls: number; isClosed: boolean; statuses: string[] }
type Options = { panes?: UiPane[]; failAt?: number; isPanesBroken?: boolean; opened?: UiOpenResult; surfaces?: { now: ('terminal' | 'desktop')[] }; env?: Record<string, string> }

// 시험 키트의 맨 위 stream.result는 비어 오므로 결과는 생성기의 반환값으로 받는다.
async function drain(stream: HookStream<TurnStepChunk, TurnStepResult>) {
  const chunks: TurnStepChunk[] = []
  const iterator = stream[Symbol.asyncIterator]()
  for (let step = await iterator.next(); ; step = await iterator.next()) {
    if (step.done) return { chunks, result: step.value }
    chunks.push(step.value)
  }
}

function tool(index: number, name: string, id: string): TurnStepChunk {
  return { kind: 'tool', index, id, name }
}

function inputs(index: number, json: string, size = 5): TurnStepChunk[] {
  const chunks: TurnStepChunk[] = []
  for (let i = 0; i < json.length; i += size) chunks.push({ kind: 'input', index, json: json.slice(i, i + size) })
  return chunks
}

// 테스트의 on은 플러그인 아래(엔진 자리)에 선다: 조각을 내는 쪽, 패널 목록·열기, state 쓰기, 상태 파일 쓰기.
function world(on: On, chunks: readonly TurnStepChunk[], options: Options = {}): World {
  const seen: World = { sets: [], opens: 0, titles: [], closes: [], writes: [], nextCalls: 0, isClosed: false, statuses: [] }
  on('turn.step', async function* () {
    seen.nextCalls += 1
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (i === options.failAt) throw new Error('원본 오류')
        yield chunks[i] as TurnStepChunk
      }
      return RESULT
    } finally {
      seen.isClosed = true
    }
  })
  on('ui.panes', async () => {
    if (options.isPanesBroken) throw new Error('패널 목록 실패')
    return { value: options.panes ?? [PLACED] }
  })
  on('ui.open', async (_engine, e) => {
    seen.opens += 1
    seen.titles.push(e.title ?? '')
    return { value: options.opened ?? { isPlaced: true } }
  })
  on('ui.close', (_engine, e) => {
    seen.closes.push(e.id)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  mock.env(on, options.env ?? { HOME: '/home/test' })
  on('fs.write', (_engine, e) => {
    seen.writes.push(e.path)
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('state.set', (_engine, e, next) => {
    seen.sets.push(e.value as View)
    return next(e)
  })
  // 플러그인이 기다리지 않고 부르는 나머지 엔진 쪽 답.
  on('session.id', () => ({ value: 'test-session' }))
  on('session.surfaces', () => ({ value: options.surfaces?.now ?? (['terminal'] as const) }))
  on('command.register', () => ({ value: { command: 'live' } }))
  on('ui.scroll', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_engine, e) => ({ text: e.text }))
  // 엔진이 그리는 진행 줄 자리. 플러그인은 이 위에 상자를 얹는다.
  on('ui.render', { component: 'Spinner' }, ($, e) => h($.ui.resolve(e).Text, null, '엔진 진행 줄') as RenderElement)
  return seen
}

const last = (seen: World) => seen.sets.at(-1)
// 끝에 붙이기($.ui.scroll to end) 시도 수. 시험 키트는 그 호출을 풀지 못해 상태 파일 errors에 ui.scroll로 남는다.
const follows = (seen: World) => {
  const text = seen.statuses.at(-1)
  if (text === undefined) return 0
  return (JSON.parse(text) as { errors: { where: string }[] }).errors.filter(error => error.where === 'ui.scroll').length
}
const boxes = (view: View | undefined) => (view?.items ?? []).flatMap(item => (item.type === 'box' ? [item] : []))
const current = (seen: World) => boxes(last(seen)).at(-1)?.entry
const window = (seen: World) => boxes(last(seen)).at(-1)?.shown

async function stream($: { turn: { step: (input: TurnStepInput) => HookStream<TurnStepChunk, TurnStepResult> } }) {
  for await (const chunk of $.turn.step(STEP)) expect(chunk).toBeDefined()
}

const WRITE: TurnStepChunk[] = [
  { kind: 'text', index: 0, text: '쓴다' },
  tool(1, 'Write', 'w-1'),
  ...inputs(1, JSON.stringify({ file_path: '/tmp/a.md', content: '# 제목\r\n본문\u0000' })),
  { kind: 'stop', stopReason: 'tool_use', usage: null },
]

// 영어 글자를 보는 시험은 언어를 고정한다. auto는 시간대를 봐서 돌리는 기계마다 다르다.
const EN = { options: { language: 'en' } } as const

test('조각과 결과를 순서·값 그대로 넘기고, 쓰는 중인 Write를 패널 자리에 싣는다', EN, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, WRITE)
  const { chunks, result } = await drain($.turn.step(STEP))
  expect(chunks).toEqual(WRITE)
  expect(result).toEqual(RESULT)
  expect(seen.nextCalls).toBe(1)
  await clock.settle()
  expect(last(seen)).toEqual({
    items: [
      { type: 'text', id: 't1/0/0', text: '쓴다' },
      {
        type: 'box',
        entry: { id: 'w-1', tool: 'Write', status: 'streaming', title: '/tmp/a.md', path: '/tmp/a.md', kind: 'code', body: '', lastLine: 2, meta: '2 lines' },
        shown: { source: '# 제목\n본문\\u0000', startLine: 1, earlier: 0, more: 0 },
      },
    ],
    todos: [],
    isWorking: true,
    isOff: false,
    seat: 'pane',
  })
})

test('원본 오류는 그냥 넘기는 단계(agentId)와 같은 오류로 전한다', async ($, on) => {
  mock.clock(on)
  const failing = world(on, WRITE, { failAt: 4 })
  const errorOf = async (input: TurnStepInput) => {
    try {
      await drain($.turn.step(input))
      return 'no error'
    } catch (error) {
      return String(error)
    }
  }
  const passed = await errorOf({ ...STEP, agentId: 'agent-1' })
  // 키트는 아래 훅의 오류를 HooksError로 감싸 전한다. 그냥 넘기는 단계와 같으면 원본 그대로다.
  expect(passed).not.toBe('no error')
  expect(await errorOf(STEP)).toBe(passed)
  expect(failing.isClosed).toBe(true)
})

test('중도에 읽기를 멈추면 원본도 닫힌다', async ($, on) => {
  mock.clock(on)
  const seen = world(on, WRITE)
  for await (const chunk of $.turn.step(STEP)) {
    expect(chunk.kind).toBe('text')
    break
  }
  expect(seen.isClosed).toBe(true)
  expect(seen.nextCalls).toBe(1)
})

test('하위 에이전트 단계는 set 0', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, WRITE)
  for await (const chunk of $.turn.step({ ...STEP, agentId: 'agent-1' })) expect(chunk).toBeDefined()
  await clock.settle()
  expect(seen.sets).toEqual([])
})

test('패널이 안 놓였으면 대화창 맨 아래 진행 줄 자리(spinner)에 싣는다', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [tool(0, 'Bash', 'b-5'), ...inputs(0, '{"command":"ls -la\\npwd"}')], { panes: [UNPLACED] })
  await stream($)
  await clock.settle()
  expect(last(seen)?.seat).toBe('spinner')
  expect(current(seen)).toEqual({ id: 'b-5', tool: 'Bash', status: 'streaming', title: 'ls -la …', path: null, kind: 'none', body: '', lastLine: null, meta: '' })
})

test('진행 줄 자리에는 쓰는 중인 호출만 omp식 상자로 그리고, 엔진의 진행 줄은 그 아래에 둔다', async ($, on) => {
  const clock = mock.clock(on)
  world(on, [tool(0, 'Write', 'w-6'), ...inputs(0, JSON.stringify({ file_path: '/tmp/s.ts', content: 'const a = 1\nconst b = 2' }))], { panes: [UNPLACED] })
  await stream($)
  await clock.settle()
  // 진행 줄 자리는 대화창 자체라, 그린 트리가 모든 화면 종류에서 통과하는지 본다(못 그리면 mount가 거절한다).
  for (const surface of SURFACES) {
    const drawn = await $.ui.mount({ plugin: 'live-viewer', surface, component: 'Spinner', props: SPINNER_PROPS })
    // 데스크톱 윗줄은 칸 SVG라 글은 alt에 있다.
    if (surface === 'desktop') expect(String((await drawn.find({ type: 'Svg' }))?.props.alt)).toMatch(/^╭── \S+ Write: 📁\/tmp\/s\.ts .*─╮$/)
    else expect(await drawn.find({ type: 'Text', text: ' 📁/tmp/s.ts' })).toBeDefined()
    expect((await drawn.find({ type: 'Code' }))?.props).toMatchObject({ source: 'const a = 1\nconst b = 2', startLine: 1, path: '/tmp/s.ts' })
    expect(await drawn.find({ type: 'Text', text: /… \(streaming\)$/ })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: '엔진 진행 줄' })).toBeDefined()
    await drawn.unmount()
  }
})

test('늦게 온 앞 호출의 input은 표시를 바꾸지 않는다', async ($, on) => {
  const clock = mock.clock(on)
  const chunks: TurnStepChunk[] = [
    tool(0, 'Write', 'w-7'),
    ...inputs(0, '{"file_path":"/tmp/x.ts","content":"앞'),
    tool(1, 'Bash', 'b-7'),
    ...inputs(1, '{"command":"pwd"}'),
    ...inputs(0, '늦은 조각"}'),
  ]
  const seen = world(on, chunks)
  await stream($)
  await clock.settle()
  expect(current(seen)).toMatchObject({ id: 'b-7', title: 'pwd', status: 'streaming' })
  expect(boxes(last(seen))[0]?.entry).toMatchObject({ id: 'w-7', body: '' })
  expect(seen.sets.some(view => boxes(view).some(item => item.shown.source.includes('늦은')))).toBe(false)
})

test('tool.call이 돌면 실행 중, 끝나면 결과(쓴 줄 수·새 파일)로 바꾸고 답은 그대로 돌려준다', EN, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [tool(0, 'Write', 'w-8'), ...inputs(0, JSON.stringify({ file_path: '/tmp/b.ts', content: 'a\nb\n' }))])
  on('tool.call', async () => {
    await clock.sleep(500)
    return { result: { type: 'create' as const, filePath: '/tmp/b.ts', content: 'a\nb\n', structuredPatch: [], originalFile: null }, text: '썼다' }
  })
  await stream($)
  const answer = $.tool.call({ tool: 'Write', tool_use_id: 'w-8', file_path: '/tmp/b.ts', content: 'a\nb\n' })
  await clock.advance(40)
  expect(current(seen)).toMatchObject({ id: 'w-8', status: 'running' })
  await clock.advance(500)
  expect((await answer).text).toBe('썼다')
  await clock.advance(40)
  expect(current(seen)).toEqual({ id: 'w-8', tool: 'Write', status: 'done', title: '/tmp/b.ts', path: '/tmp/b.ts', kind: 'code', body: '', lastLine: 3, meta: '2 lines · new file' })
  expect(window(seen)).toEqual({ source: 'a\nb\n', startLine: 1, earlier: 0, more: 0 })
})

test('Bash 오류는 실패와 종료 코드, Edit은 실제 줄 번호 diff', EN, async ($, on) => {
  const clock = mock.clock(on)
  const chunks: TurnStepChunk[] = [
    tool(0, 'Bash', 'b-9'),
    ...inputs(0, '{"command":"false"}'),
    tool(1, 'Edit', 'e-9'),
    ...inputs(1, JSON.stringify({ file_path: '/tmp/e.ts', old_string: 'b', new_string: 'B' })),
  ]
  const seen = world(on, chunks)
  on('tool.call', (_engine, e) => {
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: 'boom', interrupted: false }, text: 'Exit code 2\nboom', isError: true }
    const patch = [{ oldStart: 5, oldLines: 3, newStart: 5, newLines: 3, lines: [' a', '-b', '+B', ' c'] }]
    return { result: { filePath: '/tmp/e.ts', oldString: 'b', newString: 'B', originalFile: null, structuredPatch: patch, userModified: false, replaceAll: false }, text: '고쳤다' }
  })
  await stream($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b-9', command: 'false' })
  await clock.advance(40)
  const bash = boxes(last(seen)).find(item => item.entry.id === 'b-9')?.entry
  expect(bash).toMatchObject({ status: 'failed', kind: 'output', title: 'false' })
  expect(bash?.meta.endsWith('exit 2')).toBe(true)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e-9', file_path: '/tmp/e.ts', old_string: 'b', new_string: 'B' })
  await clock.advance(40)
  expect(current(seen)).toMatchObject({ id: 'e-9', status: 'done', kind: 'diff', meta: '[+1 -1]' })
  expect(window(seen)?.source).toBe('@@ -5,3 +5,3 @@\n a\n-b\n+B\n c')
})

test('턴이 끝났는데 쓰는 중이던 호출은 중단됨', EN, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [tool(0, 'Write', 'w-10'), ...inputs(0, '{"file_path":"/tmp/c.ts","content":"x')])
  await stream($)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: true, reason: 'aborted' })
  await clock.advance(40)
  expect(current(seen)).toMatchObject({ id: 'w-10', status: 'failed', meta: '1 line · interrupted' })
})

const LONG = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
const longWrite = (index: number, id: string) => [tool(index, 'Write', id), ...inputs(index, JSON.stringify({ file_path: '/tmp/long.ts', content: LONG }), 40)]

test('패널은 흐름을 시간순 상자로 그리고, 쓰는 중인 상자는 끝 12줄과 앞 줄 수·streaming을 단다', async ($, on) => {
  const clock = mock.clock(on)
  const chunks: TurnStepChunk[] = [
    tool(0, 'Bash', 'b-11'),
    ...inputs(0, '{"command":"pwd"}'),
    tool(1, 'Edit', 'e-11'),
    ...inputs(1, JSON.stringify({ file_path: '/tmp/e.ts', old_string: 'a', new_string: 'b' })),
    ...longWrite(2, 'w-11'),
  ]
  world(on, chunks)
  await stream($)
  await clock.settle()
  const tall = { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 60 } }
  for (const surface of SURFACES) await (await $.ui.mount({ plugin: 'live-viewer', surface, component: 'Pane', requestId: 'live', props: tall })).unmount()
  const drawn = await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: tall })
  // 데스크톱 윗줄은 칸 SVG라 제목·꼬리는 alt에 있다.
  const tops = (await drawn.findAll({ type: 'Svg' })).map(found => String(found.props.alt)).filter(alt => alt.startsWith('╭'))
  expect(tops.map(alt => / (pwd|📁\/tmp\/e\.ts|📁\/tmp\/long\.ts) /.exec(alt)?.[1])).toEqual(['pwd', '📁/tmp/e.ts', '📁/tmp/long.ts'])
  expect(tops[1]).toContain(' [+1 -1]')
  const codes = await drawn.findAll({ type: 'Code' })
  expect(codes.find(found => found.props.path === '/tmp/long.ts')?.props).toMatchObject({ startLine: 39, wrap: 'wrap' })
  expect(await drawn.find({ type: 'Text', text: '… (38 earlier lines)' })).toBeDefined()
  // 패널 20줄에는 마지막 상자(윗줄 2 + 12줄 + 앞 줄 수 + streaming = 16줄)만 든다.
  const short = await $.ui.mount({ plugin: 'live-viewer', surface: 'terminal', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect(await short.find({ type: 'Text', text: ' pwd' })).toBeUndefined()
  expect(await short.find({ type: 'Text', text: ' 📁/tmp/long.ts' })).toBeDefined()
})

test('상자 밖 도구는 입력이 끝나면 `● 도구 인자` 한 줄로, 앱 내부 도구는 줄 없이', async ($, on) => {
  const clock = mock.clock(on)
  const chunks: TurnStepChunk[] = [
    tool(0, 'Read', 'r-12'),
    ...inputs(0, JSON.stringify({ file_path: '/tmp/a.ts', offset: 36, limit: 8 })),
    tool(1, 'mcp__ccd_turn__wrap_up', 'x-12'),
    ...inputs(1, '{"recap":"끝"}'),
    tool(2, 'Grep', 'g-12'),
    ...inputs(2, '{"pattern":"foo"}'),
  ]
  const seen = world(on, chunks)
  await stream($)
  await clock.settle()
  expect(last(seen)?.items).toEqual([
    { type: 'line', id: 'r-12', tool: 'Read', args: '/tmp/a.ts:36-43' },
    { type: 'line', id: 'g-12', tool: 'Grep', args: 'foo' },
  ])
  const drawn = await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect(await drawn.find({ type: 'Text', text: '● Read' })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: '/tmp/a.ts:36-43' })).toBeDefined()
})

test('생각·답은 블록마다 한 항목에 이어 붙고, update_plan은 할 일로, 턴이 끝나면 진행 줄을 내린다', async ($, on) => {
  const clock = mock.clock(on)
  const plan = { items: [{ content: '읽기', status: 'completed' }, { content: '쓰기', status: 'in_progress' }], scope: 'first_task' }
  const chunks: TurnStepChunk[] = [
    { kind: 'thinking', index: 0, text: '먼저 ' },
    { kind: 'thinking', index: 0, text: '본다' },
    { kind: 'text', index: 1, text: '이제 ' },
    { kind: 'text', index: 1, text: '쓴다' },
    tool(2, 'mcp__ccd_turn__update_plan', 'u-13'),
    ...inputs(2, JSON.stringify(plan)),
  ]
  const seen = world(on, chunks)
  await stream($)
  await clock.settle()
  expect(last(seen)).toMatchObject({
    items: [
      { type: 'thinking', id: 't1/0/0', text: '먼저 본다' },
      { type: 'text', id: 't1/0/1', text: '이제 쓴다' },
    ],
    todos: [
      { content: '읽기', status: 'completed', activeForm: null },
      { content: '쓰기', status: 'in_progress', activeForm: null },
    ],
    isWorking: true,
  })
  const drawn = await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect(await drawn.find({ type: 'Text', text: '먼저 본다' })).toBeDefined()
  expect(await drawn.find({ type: 'Markdown' })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: '■ 쓰기' })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: '쓰기' })).toBeDefined()
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(40)
  expect(last(seen)?.isWorking).toBe(false)
})

// 따라가기 결과는 상태 파일(debug)로 센다.
test('새로 그릴 때마다 끝에 붙고, 사람이 위로 굴리면 멈췄다가 끝까지 내리거나 새 프롬프트에 다시 따라간다', { options: { debug: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [{ kind: 'text', index: 0, text: '첫 글' }], { surfaces: { now: ['desktop'] } })
  const grow = async () => {
    await stream($)
    await clock.settle()
    await pane.redraw()
    await clock.advance(1)
  }
  await stream($)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  await clock.advance(1)
  const first = follows(seen)
  expect(first).toBeGreaterThan(0)
  // 붙이기가 부른 다시 그리기는 같은 그림이라 또 붙이지 않는다.
  await pane.redraw()
  await clock.advance(1)
  expect(follows(seen)).toBe(first)
  const person = (offset: number) => $.ui.scroll({ component: 'Pane', requestId: 'live', offset, by: offset - 20, bodyRows: 20, contentRows: 40, origin: { kind: 'person' } })
  await person(5)
  await grow()
  expect(follows(seen)).toBe(first)
  await person(20)
  await grow()
  const resumed = follows(seen)
  expect(resumed).toBeGreaterThan(first)
  await person(0)
  await grow()
  expect(follows(seen)).toBe(resumed)
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await grow()
  expect(follows(seen)).toBeGreaterThan(resumed)
})

const LIVE = { command: 'live', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('/live는 코딩 뷰어 탭을 열고 엔진 답을 그대로 알린다', EN, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [])
  expect(await $.command.run(LIVE)).toMatchObject({ text: 'Opened the live viewer tab.' })
  await clock.advance(40)
  expect(seen.opens).toBe(1)
  expect(last(seen)?.seat).toBe('pane')
})

test('패널이 안 놓였으면 진행 줄 자리로 돌리고, 프롬프트마다 다시 열며, debug면 엔진 답을 상태 파일에 남긴다', { options: { debug: true, language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [], { opened: { isPlaced: false, reason: '좁다' } })
  expect(await $.command.run(LIVE)).toMatchObject({ text: 'The live viewer tab is not placed yet: 좁다' })
  await clock.advance(40)
  expect(last(seen)?.seat).toBe('spinner')
  await $.prompt.submit({ text: '하나', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '둘', wait: false, origin: { kind: 'sdk' } })
  await clock.advance(40)
  expect(seen.opens).toBe(3)
  expect(seen.writes.length).toBeGreaterThan(0)
  expect(seen.writes.every(path => path === '/home/test/.claude/live-viewer/status/test-session.json')).toBe(true)
})

// 로그까지 던지는 경우는 register-off.test.ts.
test('관찰부가 실패해도 조각·결과는 그대로이고, 그 뒤 관찰은 0', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, WRITE, { isPanesBroken: true })
  const { chunks, result } = await drain($.turn.step(STEP))
  expect(chunks).toEqual(WRITE)
  expect(result).toEqual(RESULT)
  await clock.settle()
  expect(last(seen)?.isOff).toBe(true)
  const before = seen.sets.length
  for await (const chunk of $.turn.step(STEP)) expect(chunk).toBeDefined()
  await clock.settle()
  expect(seen.sets.length).toBe(before)
})

const START = { cwd: '/tmp', surface: null, isInteractive: false } as const

test('시작 1초 뒤 놓였는데 다른 탭 뒤에 숨어 있으면 한 번 닫았다 다시 연다', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  const seen = world(on, [], { panes: [{ ...PLACED, isShown: false }] })
  await $.session.start(START)
  await clock.settle()
  expect(seen.opens).toBe(1)
  await clock.advance(1000)
  expect(seen.closes).toEqual(['live'])
  expect(seen.opens).toBe(2)
})

test('이미 보이거나 안 놓였으면 닫지 않는다', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  const seen = world(on, [], { panes: [PLACED, { ...UNPLACED, id: 'other' }] })
  await $.session.start(START)
  await clock.advance(1000)
  expect(seen.closes).toEqual([])
  expect(seen.opens).toBe(1)
})

test('화면이 붙기 전에 시작한 세션(다시 띄운 세션)은 탭을 열지 않고, 화면이 붙으면 연다', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_engine, e) => ({ cwd: e.cwd }))
  on('session.attach', (_engine, e) => ({ clientId: e.clientId }))
  const surfaces = { now: [] as ('terminal' | 'desktop')[] }
  const seen = world(on, [], { surfaces })
  await $.session.start(START)
  await clock.settle()
  expect(seen.opens).toBe(0)
  surfaces.now = ['desktop']
  await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
  await clock.settle()
  expect(seen.opens).toBe(1)
})

test('안 놓인 줄 알던 패널이 그려져도 그리기 중에 state를 쓰지 않아 관찰이 꺼지지 않는다', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, WRITE, { opened: { isPlaced: false, reason: '좁다' }, panes: [UNPLACED] })
  await $.command.run(LIVE)
  await clock.settle()
  const before = seen.sets.length
  await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  // 그리는 동안에는 쓰지 않고, 다음 차례에 놓였다고 적는다.
  expect(seen.sets.length).toBe(before)
  await clock.advance(1)
  expect(last(seen)).toMatchObject({ isOff: false, seat: 'pane' })
})

test('debug가 꺼져 있으면(기본) 상태 파일을 쓰지 않는다', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [], { opened: { isPlaced: false, reason: 'narrow' } })
  await $.command.run(LIVE)
  await clock.advance(40)
  expect(seen.writes).toEqual([])
})

test('CLAUDE_CONFIG_DIR이 있으면 상태 파일은 그 아래', { options: { debug: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, [], { opened: { isPlaced: false, reason: 'narrow' }, env: { HOME: '/home/test', CLAUDE_CONFIG_DIR: '/cfg' } })
  await $.command.run(LIVE)
  await clock.advance(40)
  expect(seen.writes.length).toBeGreaterThan(0)
  expect(seen.writes.every(path => path === '/cfg/live-viewer/status/test-session.json')).toBe(true)
})

for (const [name, options, title] of [['auto', {}, '코딩 뷰어'], ['en', EN, 'Live viewer']] as const) {
  test(`로캘 변수가 ko일 때 language ${name}면 탭 제목은 ${title}`, options, async ($, on) => {
    const clock = mock.clock(on)
    const seen = world(on, [], { env: { HOME: '/home/test', LANG: 'ko_KR.UTF-8' } })
    await $.command.run(LIVE)
    await clock.advance(40)
    expect(seen.titles).toEqual([title])
  })
}
