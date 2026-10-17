import type { ElementTable, RenderElement } from 'claude-code'

import type { Entry, Item, Shown, Todo, View } from '../types'
import { type Places, shortPath } from './feed'
import type { Words } from './words'

// omp(oh-my-pi 18.11) 화면을 본뜬 그림. 흐름을 위에서 아래로 시간순으로 그린다: Write·Edit·Bash는 상자,
// 그 밖 도구는 `● 도구 인자` 한 줄, 생각은 이탤릭, 답은 Markdown. 맨 아래에 할 일 나무와 진행 줄. 호스트가 테두리 위에 제목을 못 그려(2026-10-15 확인 시험) 상자 윗줄·아랫줄은
// 글자로 그리고 본문은 배경만 칠한다.

const SPIN = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
const SPIN_FRAME_MS = 120

// omp 설치본의 light·titanium 테마 값. 코드 글자색은 호스트 테마를 따르므로 배경도 테마에 맞춰 고른다.
export type Palette = {
  pending: string
  done: string
  failed: string
  rule: string
  dim: string
  thinking: string
  accent: string
  success: string
  error: string
}
export const LIGHT: Palette = {
  pending: '#e8e8f0',
  done: '#e8f0e8',
  failed: '#f0e8e8',
  rule: '#b0b0b0',
  dim: '#767676',
  thinking: '#6c6c6c',
  accent: '#5a8080',
  success: '#588458',
  error: '#aa5555',
}
export const TITANIUM: Palette = {
  pending: '#0f1216',
  done: '#0f1216',
  failed: '#1a0f10',
  rule: '#2a3038',
  dim: '#6b7280',
  thinking: '#9ca3b0',
  accent: '#00b4ff',
  success: '#00ff88',
  error: '#ff4757',
}

// 설정 `palette`가 light·dark면 그대로. auto는 데스크톱이면 light(앱이 CLI에 밝기를 넘기지 않는다), 터미널은 /config 테마를 따른다.
export function paletteOf(choice: unknown, surface: string, theme: string | null): Palette {
  if (choice === 'light') return LIGHT
  if (choice === 'dark') return TITANIUM
  return surface === 'desktop' || theme?.startsWith('light') === true ? LIGHT : TITANIUM
}

// 그릴 자리: 줄 폭, 쓸 수 있는 줄 수, 팔레트, 경로를 줄일 곳, 글자.
export type Layout = { columns: number; rows: number; palette: Palette; places: Places; words: Words }

const isPending = (entry: Entry) => entry.status === 'streaming' || entry.status === 'running'

// 한글·한자·전각·이모지는 두 칸을 차지한다.
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    code >= 0x20000
  )
}

export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1
  return width
}

// 앞을 잘라 width칸에 맞춘다(경로는 끝이 중요하다).
function keepEnd(text: string, width: number): string {
  if (cellWidth(text) <= width) return text
  const chars = [...text]
  while (chars.length > 0 && cellWidth(`…${chars.join('')}`) > width) chars.shift()
  return `…${chars.join('')}`
}

function markOf(entry: Entry): string {
  if (entry.status === 'done') return entry.tool === 'Bash' ? '✓' : '✎'
  if (entry.status === 'failed') return '✘'
  // 그릴 때마다 한 칸: 조각이 오는 동안 돌고, 모델이 멈추면 같이 멈춘다.
  return SPIN[Math.floor(Date.now() / SPIN_FRAME_MS) % SPIN.length] ?? '·'
}

const markColor = (entry: Entry, palette: Palette) => (entry.status === 'failed' ? palette.error : entry.status === 'done' ? palette.success : palette.accent)
const backgroundOf = (entry: Entry, palette: Palette) => (entry.status === 'failed' ? palette.failed : entry.status === 'done' ? palette.done : palette.pending)

// 윗줄 `╭── ✎ Edit: 📁경로 [+1] ───╮`의 조각. 폭이 모자라면 제목 앞을 자르고, 채움은 늘 한 칸 이상.
export function topParts(entry: Entry, columns: number, places: Places) {
  const isBash = entry.tool === 'Bash'
  const mark = markOf(entry)
  const label = isBash ? '$' : `${entry.tool}:`
  const tail = entry.meta === '' ? '' : ` ${entry.meta}`
  const title = isBash || entry.title === '' ? entry.title : `📁${shortPath(entry.title, places)}`
  // `╭── ` 4칸, 기호, ` `+label, ` `+제목, 꼬리, ` `+채움, `╮` 1칸.
  const fixed = 4 + cellWidth(mark) + 1 + cellWidth(label) + 1 + cellWidth(tail) + 1 + 1
  const shownTitle = keepEnd(title, Math.max(1, columns - fixed - 1))
  const fill = Math.max(1, columns - fixed - cellWidth(shownTitle))
  return { mark, label, title: shownTitle, tail, fill: `${'─'.repeat(fill)}╮` }
}

function drawTop(els: ElementTable, entry: Entry, layout: Layout): RenderElement {
  const { Box, Text } = els
  const { palette } = layout
  const parts = topParts(entry, layout.columns, layout.places)
  return (
    <Box flexDirection="row">
      <Text color={palette.rule} mono>
        {'╭── '}
      </Text>
      <Text color={markColor(entry, palette)} mono>
        {parts.mark}
      </Text>
      <Text weight="bold" mono>{` ${parts.label}`}</Text>
      <Text mono>{` ${parts.title}`}</Text>
      {parts.tail !== '' && (
        <Text color={palette.dim} mono>
          {parts.tail}
        </Text>
      )}
      <Text color={palette.rule} mono>{` ${parts.fill}`}</Text>
    </Box>
  )
}

function drawCode(els: ElementTable, entry: Entry, shown: Shown): RenderElement | null {
  const { Code } = els
  if (shown.source.trim() === '') return null
  const path = entry.path ?? undefined
  if (entry.kind === 'diff') return <Code source={shown.source} path={path} format="diff" wrap="wrap" />
  if (entry.kind === 'code') return <Code source={shown.source} path={path} startLine={shown.startLine ?? undefined} wrap="wrap" />
  return <Code source={shown.source} wrap="wrap" />
}

// 상자 하나: 윗줄, 배경을 칠한 본문(접힌 줄 수·코드·쓰는 중 표시), 아랫줄.
export function drawBox(els: ElementTable, entry: Entry, shown: Shown, layout: Layout): RenderElement {
  const { Box, Text } = els
  const { palette, columns } = layout
  const footer = entry.status === 'streaming' ? 'streaming' : entry.status === 'running' ? 'running' : ''
  return (
    <Box key={entry.id} flexDirection="column">
      {drawTop(els, entry, layout)}
      <Box flexDirection="column" backgroundColor={backgroundOf(entry, palette)} paddingX={1}>
        {shown.earlier > 0 && <Text color={palette.dim}>{`… (${shown.earlier} earlier lines)`}</Text>}
        {drawCode(els, entry, shown)}
        {shown.more > 0 && <Text color={palette.dim}>{`… ${shown.more} more lines`}</Text>}
        {footer !== '' && <Text color={palette.dim}>{`${markOf(entry)} … (${footer})`}</Text>}
      </Box>
      <Text color={palette.rule} mono>{`╰${'─'.repeat(Math.max(0, columns - 2))}╯`}</Text>
    </Box>
  )
}

function drawLine(els: ElementTable, item: Extract<Item, { type: 'line' }>, palette: Palette): RenderElement {
  const { Box, Text } = els
  return (
    <Box key={item.id} flexDirection="row" columnGap={1}>
      <Text weight="bold">{`● ${item.tool}`}</Text>
      {item.args !== '' && (
        <Text color={palette.dim} wrap="truncate-end">
          {item.args}
        </Text>
      )}
    </Box>
  )
}

function drawWords(els: ElementTable, item: Extract<Item, { type: 'text' | 'thinking' }>, palette: Palette): RenderElement {
  const { Box, Markdown, Text } = els
  return (
    <Box key={`${item.type}:${item.id}`} flexDirection="column">
      {item.type === 'thinking' ? (
        <Text italic color={palette.thinking}>
          {item.text}
        </Text>
      ) : (
        <Markdown text={item.text} />
      )}
    </Box>
  )
}

function drawItem(els: ElementTable, item: Item, layout: Layout): RenderElement {
  if (item.type === 'box') return drawBox(els, item.entry, item.shown, layout)
  if (item.type === 'line') return drawLine(els, item, layout.palette)
  return drawWords(els, item, layout.palette)
}

// 나무에 보일 할 일 수. 넘으면 진행 중 앞뒤로 이만큼과 `… N more`.
const TODO_ROWS = 8
const TODO_MARK: Record<Todo['status'], string> = { pending: '□', in_progress: '■', completed: '✓' }

function todoWindow(todos: readonly Todo[]): { start: number; shown: readonly Todo[] } {
  if (todos.length <= TODO_ROWS) return { start: 0, shown: todos }
  const current = Math.max(0, todos.findIndex(todo => todo.status === 'in_progress'))
  const start = Math.min(Math.max(0, current - 2), todos.length - TODO_ROWS)
  return { start, shown: todos.slice(start, start + TODO_ROWS) }
}

function drawTodos(els: ElementTable, todos: readonly Todo[], palette: Palette): RenderElement {
  const { Box, Text } = els
  const done = todos.filter(todo => todo.status === 'completed').length
  const { start, shown } = todoWindow(todos)
  // 창 위·아래로 접힌 할 일 수.
  const above = start
  const below = todos.length - start - shown.length
  return (
    <Box key="todos" flexDirection="column" marginTop={1}>
      <Text>
        <Text color={palette.accent} weight="bold">
          TODO
        </Text>
        <Text color={palette.dim}>{` · ${done}/${todos.length}`}</Text>
      </Text>
      {above > 0 && <Text color={palette.dim}>{`├─ … ${above} more`}</Text>}
      {shown.map((todo, i) => {
        const isLast = i === shown.length - 1 && below === 0
        const color = todo.status === 'completed' ? palette.dim : undefined
        return (
          <Text key={`todo:${start + i}`}>
            <Text color={palette.accent}>{isLast ? '└─ ' : '├─ '}</Text>
            <Text color={color} weight={todo.status === 'in_progress' ? 'bold' : 'regular'}>{`${TODO_MARK[todo.status]} ${todo.content}`}</Text>
          </Text>
        )
      })}
      {below > 0 && <Text color={palette.dim}>{`└─ … ${below} more`}</Text>}
    </Box>
  )
}

// 턴이 도는 동안 진행 중 할 일을 스피너와 함께. 진행 중 할 일이 없으면 그리지 않는다.
function workingWords(view: View): string | null {
  if (!view.isWorking) return null
  const current = view.todos.find(todo => todo.status === 'in_progress')
  return current === undefined ? null : (current.activeForm ?? current.content)
}

const spinFrame = () => SPIN[Math.floor(Date.now() / SPIN_FRAME_MS) % SPIN.length] ?? '·'

const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length)

// 글이 차지할 줄 수 어림: 줄마다 폭으로 나눈 줄바꿈까지 센다.
const wrappedRows = (text: string, columns: number) => text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(cellWidth(line) / Math.max(1, columns))), 0)

// 항목이 차지할 줄 수 어림. 상자 안 긴 줄의 줄바꿈은 세지 않는다.
function rowsOf(item: Item, columns: number): number {
  if (item.type === 'line') return 1
  if (item.type !== 'box') return wrappedRows(item.text, columns)
  const { shown, entry } = item
  return 2 + lineCount(shown.source) + (shown.earlier > 0 ? 1 : 0) + (shown.more > 0 ? 1 : 0) + (isPending(entry) ? 1 : 0)
}

// 끝에서부터 rows줄에 드는 항목만. 마지막 항목은 늘 넣는다.
function fit(items: readonly Item[], rows: number, columns: number): readonly Item[] {
  let used = 0
  let start = items.length
  while (start > 0) {
    const next = rowsOf(items[start - 1] as Item, columns)
    if (start < items.length && used + next > rows) break
    used += next
    start--
  }
  return items.slice(start)
}

// 패널 전체: 흐름, 할 일 나무, 진행 줄. 나무와 진행 줄 자리를 먼저 빼고 남는 줄에 흐름을 채운다.
export function drawView(els: ElementTable, view: View, layout: Layout): RenderElement {
  const { Box, Text } = els
  const { palette, words } = layout
  if (view.isOff) return <Text color={palette.dim}>{words.off}</Text>
  if (view.items.length === 0 && view.todos.length === 0) return <Text color={palette.dim}>{words.empty}</Text>
  const working = workingWords(view)
  const todoRows = view.todos.length === 0 ? 0 : 2 + Math.min(view.todos.length, TODO_ROWS + 2)
  const rows = Math.max(1, layout.rows - todoRows - (working === null ? 0 : 2))
  return (
    <Box flexDirection="column">
      {fit(view.items, rows, layout.columns).map(item => drawItem(els, item, layout))}
      {view.todos.length > 0 && drawTodos(els, view.todos, palette)}
      {working !== null && (
        <Box key="working" marginTop={1}>
          <Text>
            <Text color={palette.accent}>{`${spinFrame()} `}</Text>
            <Text>{working}</Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}
