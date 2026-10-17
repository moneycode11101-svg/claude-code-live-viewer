import type { Item, Todo } from '../types'

// 흐름 항목을 만드는 순수 함수들: 상자 밖 도구의 한 줄 인자·숨길 도구, 답·생각 글 잇기, 할 일 갱신.

// 상자 밖 도구는 입력 원문을 이만큼까지만 모은다. 넘으면 이름만 둔다.
export const RAW_LIMIT = 16 * 1024

// 앱 내부 도구(wrap_up·mark_chapter·update_plan 등)와 할 일 도구는 흐름에 줄을 만들지 않는다.
export const isHidden = (tool: string) => tool.startsWith('mcp__ccd_') || tool === 'TodoWrite'

export type Places = { cwd: string | null; home: string | null }

// 세션 폴더 안이면 상대 경로, 홈 안이면 ~로 줄인다.
export function shortPath(path: string, places: Places): string {
  if (places.cwd !== null && path.startsWith(`${places.cwd}/`)) return path.slice(places.cwd.length + 1)
  if (places.home !== null && path.startsWith(`${places.home}/`)) return `~${path.slice(places.home.length)}`
  return path
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const textOf = (value: unknown) => (typeof value === 'string' ? value : '')
const numberOf = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

// Read의 offset은 1부터 센 첫 줄, limit은 줄 수다.
function readArgs(input: Record<string, unknown>, places: Places): string {
  const path = shortPath(textOf(input.file_path), places)
  const offset = numberOf(input.offset)
  const limit = numberOf(input.limit)
  if (limit !== null) return `${path}:${offset ?? 1}-${(offset ?? 1) + limit - 1}`
  return offset === null ? path : `${path}:${offset}`
}

// 한 줄 `● {도구} {인자}`의 인자. 모르는 도구나 깨진 입력은 빈 글자(도구 이름만).
export function lineArgs(tool: string, input: unknown, places: Places): string {
  if (!isRecord(input)) return ''
  if (tool === 'Read') return readArgs(input, places)
  if (tool === 'Grep') return [textOf(input.pattern), shortPath(textOf(input.path), places)].filter(part => part !== '').join(' ')
  if (tool === 'Glob') return textOf(input.pattern)
  if (tool === 'WebFetch') return textOf(input.url)
  if (tool === 'WebSearch') return textOf(input.query)
  if (tool === 'Agent' || tool === 'Task') return textOf(input.description)
  return ''
}

// 모은 입력 원문을 푼다. 상한을 넘었거나 깨졌으면 null.
export function parseRaw(raw: string): unknown {
  if (raw.length > RAW_LIMIT) return null
  try {
    return JSON.parse(raw)
  } catch {
    // 흐름이 끊겨 입력이 덜 왔거나 깨진 것이다. 한 줄은 도구 이름만, 할 일은 그대로 둔다.
    return null
  }
}

// 답·생각 글은 항목마다 끝 이만큼만 둔다.
export const TEXT_LIMIT = 4000

// 같은 id(단계·블록)의 마지막 글 항목에 이어 붙이고, 아니면 새 항목. 원문은 끝 TEXT_LIMIT자만 둔다.
export function appendText(items: readonly Item[], type: 'text' | 'thinking', id: string, piece: string, limit: number): Item[] {
  const lastItem = items.at(-1)
  if (lastItem !== undefined && lastItem.type === type && lastItem.id === id) {
    const joined = lastItem.text + piece
    // 서로게이트 짝은 표시 사본(toDisplay)이 맞추므로 여기서는 길이만 자른다.
    return [...items.slice(0, -1), { type, id, text: joined.length > TEXT_LIMIT ? joined.slice(-TEXT_LIMIT) : joined }]
  }
  return [...items, { type, id, text: piece.slice(-TEXT_LIMIT) }].slice(-limit)
}

const TODO_WRITE = 'TodoWrite'
const UPDATE_PLAN = 'mcp__ccd_turn__update_plan'
export const isTodoTool = (tool: string) => tool === TODO_WRITE || tool === UPDATE_PLAN

const statusOf = (value: unknown): Todo['status'] => (value === 'completed' || value === 'in_progress' ? value : 'pending')

function todosOf(list: unknown, key: 'todos' | 'items'): Todo[] | null {
  if (!Array.isArray(list)) return null
  return list.filter(isRecord).map(todo => ({
    content: textOf(todo.content),
    status: statusOf(todo.status),
    activeForm: key === 'todos' && typeof todo.activeForm === 'string' ? todo.activeForm : null,
  }))
}

const setStatus = (todos: readonly Todo[], at: number, status: Todo['status']) => todos.map((todo, i) => (i === at ? { ...todo, status } : todo))

// TodoWrite는 통째로, update_plan은 items면 통째로, advance·done(1부터)·start는 그 자리만 바꾼다. 바꿀 것이 없으면 null.
export function applyTodos(todos: readonly Todo[], tool: string, input: unknown): Todo[] | null {
  if (!isRecord(input)) return null
  if (tool === TODO_WRITE) return todosOf(input.todos, 'todos')
  if (tool !== UPDATE_PLAN) return null
  let next = todosOf(input.items, 'items') ?? [...todos]
  if (input.advance === true) {
    next = next.map(todo => (todo.status === 'in_progress' ? { ...todo, status: 'completed' as const } : todo))
    const pending = next.findIndex(todo => todo.status === 'pending')
    if (pending !== -1) next = setStatus(next, pending, 'in_progress')
  }
  if (Array.isArray(input.done)) for (const at of input.done) if (typeof at === 'number') next = setStatus(next, at - 1, 'completed')
  if (typeof input.start === 'number') next = setStatus(next, input.start - 1, 'in_progress')
  return next
}
