import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, ThemeKey } from 'claude-code'

import type { Entry, Item, View } from '../types'
import { cellWidth, LIGHT, ruleSvg, TITANIUM, topParts } from './draw'
import { shownOf } from './entry'

// 색은 테마 키만 쓰고 dimColor는 쓰지 않는다(omp 팔레트 밖 색 금지). Record로 두어 타입의 키가 늘면 tsc가 알린다.
const THEME_KEYS: Record<ThemeKey, true> = {
  text: true,
  inverseText: true,
  inactive: true,
  subtle: true,
  suggestion: true,
  remember: true,
  success: true,
  error: true,
  warning: true,
  merged: true,
  claude: true,
  permission: true,
  planMode: true,
  autoAccept: true,
  promptBorder: true,
  bashBorder: true,
  ide: true,
  diffAdded: true,
  diffRemoved: true,
  diffAddedDimmed: true,
  diffRemovedDimmed: true,
  diffAddedWord: true,
  diffRemovedWord: true,
}
const COLOR_PROPS = ['color', 'borderColor', 'backgroundColor']
const SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const
const CALLS = { plugin: 'live-viewer', key: 'calls' } as const
const SPINNER_PROPS = { word: 'Working', message: null, suffix: '', mode: 'tool-input' } as const
const PANE_PROPS = { title: '모니터링', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const

const entry = (id: string, tool: string, status: Entry['status'], kind: Entry['kind'], body = ''): Entry => ({
  id,
  tool,
  status,
  title: tool === 'Bash' ? 'ls' : `/tmp/${id}.ts`,
  path: tool === 'Bash' ? null : `/tmp/${id}.ts`,
  kind,
  body,
  lastLine: kind === 'code' ? 2 : null,
  meta: status === 'done' ? '2줄' : '',
})

const box = (value: Entry): Item => ({ type: 'box', entry: { ...value, body: '' }, shown: shownOf(value) })

// 모든 도구와 상태가 한 번씩 나오게 고른 호출들. 맨 끝이 지금 상자.
const VIEWS: View[] = [
  ['streaming', 'Write', 'code'],
  ['running', 'Bash', 'output'],
  ['done', 'Edit', 'diff'],
  ['failed', 'Bash', 'output'],
  ['done', 'Bash', 'output'],
].map(([status, tool, kind], i, all) => ({
  items: [...all.slice(i), ...all.slice(0, i)].reverse().map(([s, t, k], j) => box(entry(`c${j}`, t as string, s as Entry['status'], k as Entry['kind'], k === 'diff' ? '@@ -1,1 +1,1 @@\n-a\n+b' : 'a\nb'))),
  todos: [],
  isWorking: false,
  isOff: false,
  seat: 'pane' as const,
}))
const OTHERS: View[] = [
  {
    items: [
      { type: 'line', id: 'r', tool: 'Read', args: 'a.ts:36-43' },
      { type: 'line', id: 'g', tool: 'Agent', args: '' },
    ],
    todos: [],
    isWorking: false,
    isOff: false,
    seat: 'pane',
  },
  { items: [box(entry('e', 'Bash', 'done', 'output'))], todos: [], isWorking: false, isOff: false, seat: 'pane' },
  { items: [], todos: [], isWorking: false, isOff: false, seat: 'pane' },
  { items: [], todos: [], isWorking: false, isOff: true, seat: 'pane' },
  {
    items: [
      { type: 'thinking', id: 's/0', text: '생각' },
      { type: 'text', id: 's/1', text: '**답**' },
    ],
    todos: [
      { content: '하나', status: 'completed', activeForm: null },
      { content: '둘', status: 'in_progress', activeForm: '둘 하는 중' },
      { content: '셋', status: 'pending', activeForm: null },
    ],
    isWorking: true,
    isOff: false,
    seat: 'pane',
  },
]
const NOW = 1_800_000_000_000

// 엔진 자리: 패널·진행 줄. 그릴 표시는 시험이 $.state 읽기 답으로 넣는다.
let shown: View = { items: [], todos: [], isWorking: false, isOff: false, seat: 'pane' }

function world(on: On): void {
  on('state.get', (_engine, e, next) => (e.key === CALLS.key ? { value: { value: shown, version: 1 } } : next(e)))
  mock.env(on, { HOME: '/home/test' })
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('command.register', () => ({ value: { command: 'live' } }))
  on('prompt.submit', (_engine, e) => ({ text: e.text }))
  on('ui.render', { component: 'Spinner' }, ($, e) => h($.ui.resolve(e).Text, null, '엔진 진행 줄') as RenderElement)
}

// 그린 트리를 돌며 색 값과 dimColor를 모은다.
function colorsOf(node: unknown, found: { colors: Set<string>; dims: number }): void {
  if (Array.isArray(node)) {
    for (const child of node) colorsOf(child, found)
    return
  }
  if (typeof node !== 'object' || node === null) return
  const record = node as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (key === 'dimColor') found.dims += 1
    else if (COLOR_PROPS.includes(key) && value !== undefined) found.colors.add(String(value))
    // 데스크톱 상자 윗줄·아랫줄은 칸 SVG라 색이 마크업 안에 있다(색 없는 조각의 앱 글자색 .ink는 팔레트 밖이라 따로 본다).
    else if (key === 'source' && typeof value === 'string' && value.startsWith('<svg')) for (const [, color] of value.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)) found.colors.add(String(color))
    else colorsOf(value, found)
  }
}

test('그린 트리의 색은 모두 omp 팔레트 값이거나 ThemeKey이고, dimColor·테두리 상자·절대 위치가 없다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await $.prompt.submit({ text: '시작', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  const found = { colors: new Set<string>(), dims: 0 }
  for (const view of [...VIEWS, ...OTHERS]) {
    shown = view
    for (const surface of SURFACES) {
      const pane = await $.ui.mount({ plugin: 'live-viewer', surface, component: 'Pane', requestId: 'live', props: PANE_PROPS })
      const tree = await pane.drawn()
      colorsOf(tree, found)
      // 호스트는 테두리 위 제목을 못 그린다(2026-10-15 확인 시험): 테두리 상자·절대 위치를 쓰지 않는다.
      expect(JSON.stringify(tree)).not.toMatch(/"borderStyle"|"absolute"/)
      await pane.unmount()
      // 패널이 안 놓였을 때 대화창 맨 아래 진행 줄 자리에 그리는 지금 칸.
      shown = { ...view, seat: 'spinner' }
      const spinner = await $.ui.mount({ plugin: 'live-viewer', surface, component: 'Spinner', props: SPINNER_PROPS })
      colorsOf(await spinner.drawn(), found)
      await spinner.unmount()
      shown = view
    }
  }
  expect(found.dims).toBe(0)
  const palettes = [...Object.values(LIGHT), ...Object.values(TITANIUM)]
  expect([...found.colors].filter(color => !(color in THEME_KEYS) && !palettes.includes(color))).toEqual([])
  // 데스크톱은 light, 터미널은 테마를 못 읽으면 titanium. 상태 배경·줄·기호 색이 실제로 그려졌는지.
  const drawnColors = [LIGHT.pending, LIGHT.done, LIGHT.failed, LIGHT.rule, LIGHT.dim, LIGHT.thinking, LIGHT.accent, LIGHT.success, LIGHT.error, TITANIUM.pending, TITANIUM.rule]
  expect(drawnColors.filter(color => !found.colors.has(color))).toEqual([])
})

test('터미널 패널은 맨 겉 바탕을 팔레트 바탕색으로 칠하고 옆에 붙으면 바닥까지 채운다. 데스크톱은 칠하지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await clock.settle()
  shown = VIEWS[0] ?? shown
  const dock = await $.ui.mount({ plugin: 'live-viewer', surface: 'terminal', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect((await dock.find({ type: 'Box' }))?.props).toMatchObject({ backgroundColor: TITANIUM.page, minHeight: PANE_PROPS.scroll.bodyRows })
  await dock.unmount()
  const inline = await $.ui.mount({ plugin: 'live-viewer', surface: 'terminal', component: 'Pane', requestId: 'live', props: { ...PANE_PROPS, placement: 'inline' } })
  expect((await inline.find({ type: 'Box' }))?.props).toMatchObject({ backgroundColor: TITANIUM.page, minHeight: 0 })
  await inline.unmount()
  const desktop = await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect(JSON.stringify(await desktop.drawn())).not.toContain(LIGHT.page)
  await desktop.unmount()
})

test('윗줄·아랫줄은 한글 경로와 이모지를 두 칸으로 세어 정확히 폭을 채우고, 넘치면 경로 앞을 자른다', () => {
  const places = { cwd: '/repo', home: '/home/test' }
  const edit: Entry = { ...entry('k', 'Edit', 'done', 'diff'), title: '/repo/문서/설계.md', meta: '[+1]' }
  for (const columns of [80, 40]) {
    const parts = topParts(edit, columns, places)
    expect(cellWidth(`╭── ${parts.mark} ${parts.label} ${parts.title}${parts.tail} ${parts.fill}`)).toBe(columns)
  }
  expect(topParts(edit, 80, places).title).toBe('📁문서/설계.md')
  const long = topParts({ ...edit, title: `/elsewhere/${'깊은/'.repeat(20)}끝.ts` }, 40, places)
  expect(long.title.startsWith('…')).toBe(true)
  expect(long.title.endsWith('끝.ts')).toBe(true)
  // 두 칸 글자 때문에 한 칸이 남을 수 있다.
  expect(['─╮', '──╮']).toContain(long.fill)
})

test('데스크톱 칸 SVG는 columns칸 격자에 글자를 놓아 끝 모서리가 마지막 칸에 오고, 늘 슬롯보다 넓게 그려 줄여 맞춘다', () => {
  const places = { cwd: '/repo', home: '/home/test' }
  const edit: Entry = { ...entry('k', 'Edit', 'done', 'diff'), title: '/repo/문서/<설계>.md', meta: '[+1]' }
  for (const columns of [80, 40]) {
    const parts = topParts(edit, columns, places)
    const svg = ruleSvg(
      [{ text: '╭── ', color: LIGHT.rule }, { text: parts.mark, color: LIGHT.success }, { text: ` ${parts.label}`, isBold: true }, { text: ` ${parts.title}${parts.tail}` }, { text: ` ${parts.fill}`, color: LIGHT.rule }],
      columns,
    )
    expect(svg).toContain(`viewBox="0 0 ${columns * 10} 20"`)
    // 마크업 폭은 칸 수의 두 배 px: 한 칸이 10px보다 작은 슬롯이면 늘 줄여 그린다.
    expect(svg).toContain(`width="${columns * 20}" height="40"`)
    // 한글·이모지를 두 칸으로 세어도 끝 모서리 ╮는 마지막 칸(columns-1)에 온다.
    expect(svg).toContain(`M${(columns - 1) * 10} 10H${(columns - 1) * 10 + 2}Q`)
    expect(svg).not.toContain('<설계>')
  }
  expect(ruleSvg([{ text: '<a&b>' }], 5)).toContain('>&lt;</text>')
  // 색 없는 조각은 앱의 밝은·어두운 글자색을 따른다.
  const plain = ruleSvg([{ text: 'ab' }], 2)
  expect(plain).toContain('<g class="ink">')
  expect(plain).toContain('@media (prefers-color-scheme:dark)')
  // 선 글자는 칸 끝까지 잇는 선, 아랫줄 모서리는 위로 올라간다.
  const bottom = ruleSvg([{ text: '╰──╯', color: LIGHT.rule }], 4)
  expect(bottom).toContain(`<path d="M5 0V7Q5 10 8 10H10M10 10H20M20 10H30M35 0V7Q35 10 32 10H30" fill="none" stroke="${LIGHT.rule}"`)
  expect(bottom).not.toContain('<text')
})

test('할 일 나무는 끝/전체를 달고, 8개를 넘으면 진행 중 근처 8개와 `… N more`, 진행 줄은 activeForm', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await clock.settle()
  const many = Array.from({ length: 10 }, (_, i) => ({ content: `일 ${i + 1}`, status: i < 5 ? ('completed' as const) : i === 5 ? ('in_progress' as const) : ('pending' as const), activeForm: i === 5 ? '여섯째 하는 중' : null }))
  shown = { items: [], todos: many, isWorking: true, isOff: false, seat: 'pane' }
  const pane = await $.ui.mount({ plugin: 'live-viewer', surface: 'desktop', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: ' · 5/10' })).toBeDefined()
  // 진행 중(6번째) 앞 둘부터 8개: 3~10번째. 위로 접힌 둘은 `… 2 more`.
  expect(await pane.find({ type: 'Text', text: /일 2$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '✓ 일 4' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '■ 일 6' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '├─ … 2 more' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^└─ □ 일 10$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '여섯째 하는 중' })).toBeDefined()
  shown = { ...shown, isWorking: false }
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: '여섯째 하는 중' })).toBeUndefined()
})

// 설정 palette·language: 터미널에서도 light를 고르면 light 배경, ko면 빈 패널 글이 한국어.
test('palette light는 터미널에서도 light 배경, language ko는 한국어 글자', { options: { palette: 'light', language: 'ko' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await $.prompt.submit({ text: '시작', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  const found = { colors: new Set<string>(), dims: 0 }
  shown = VIEWS[0] as View
  const pane = await $.ui.mount({ plugin: 'live-viewer', surface: 'terminal', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  colorsOf(await pane.drawn(), found)
  await pane.unmount()
  expect(found.colors.has(LIGHT.pending) || found.colors.has(LIGHT.done) || found.colors.has(LIGHT.failed)).toBe(true)
  expect([TITANIUM.pending, TITANIUM.failed].filter(color => found.colors.has(color))).toEqual([])
  shown = { items: [], todos: [], isWorking: false, isOff: false, seat: 'pane' }
  const empty = await $.ui.mount({ plugin: 'live-viewer', surface: 'terminal', component: 'Pane', requestId: 'live', props: PANE_PROPS })
  expect(await empty.find({ type: 'Text', text: 'Claude가 도구를 부르면 여기 실시간으로 찍힌다' })).toBeDefined()
  await empty.unmount()
})
