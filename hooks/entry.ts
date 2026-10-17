import type { Entry, Shown } from '../types'
import { toDisplay } from './display'
import type { State } from './partial'
import { EN, type Words } from './words'

// 호출 하나의 표시(Entry)를 만들고 그릴 만큼 자르는 순수 함수들. 흐름 쪽(register)은 이것만 불러 쓴다.

const PATH_LIMIT = 4096
const CONTEXT_LINES = 3
const NO_LIMIT = Number.POSITIVE_INFINITY

type Values = State['values']

export type Change = { text: string; added: number; removed: number }

// 마지막 줄바꿈 뒤 빈 줄은 줄이 아니라 끝 표시라 뺀다.
function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}

// 앞뒤로 같은 줄은 3줄까지 문맥으로 두고 가운데를 -/+로 쓴 hunk 하나. new가 아직 안 왔으면 null.
export function hunk(before: string, after: string | null): Change {
  const a = linesOf(before)
  const b = after === null ? [] : linesOf(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const lead = Math.min(head, CONTEXT_LINES)
  const trail = Math.min(tail, CONTEXT_LINES)
  const removed = a.slice(head, a.length - tail)
  const added = b.slice(head, b.length - tail)
  const lines = [
    ...a.slice(head - lead, head).map(line => ` ${line}`),
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
    ...a.slice(a.length - tail, a.length - tail + trail).map(line => ` ${line}`),
  ]
  if (lines.length === 0) return { text: '', added: 0, removed: 0 }
  const start = head - lead + 1
  const header = `@@ -${start},${lead + removed.length + trail} +${start},${lead + added.length + trail} @@`
  return { text: `${header}\n${lines.join('\n')}`, added: added.length, removed: removed.length }
}

// omp처럼 0인 쪽은 뺀다: [+3 -1], [+2], [-1].
export function changeMeta(change: Change): string {
  const parts = [change.added > 0 ? `+${change.added}` : '', change.removed > 0 ? `-${change.removed}` : ''].filter(part => part !== '')
  return parts.length === 0 ? '' : `[${parts.join(' ')}]`
}

// turn.step 조각을 풀이한 값으로, 모델이 아직 쓰고 있는 호출의 표시를 만든다.
export function streamingEntry(id: string, tool: string, parser: State, isReadable: boolean, words: Words = EN): Entry {
  const values: Values = parser.values
  const path = values.file_path === undefined ? null : toDisplay(values.file_path, PATH_LIMIT)
  const base: Entry = { id, tool, status: 'streaming', title: path ?? '', path, kind: 'none', body: '', lastLine: null, meta: '' }
  if (tool === 'Bash') {
    const command = values.command === undefined ? '' : toDisplay(values.command, PATH_LIMIT)
    return { ...base, title: parser.truncated.command ? `${command} …` : command, path: null }
  }
  if (!isReadable) return base
  if (tool === 'Write' && values.content !== undefined) {
    const lastLine = (parser.breaks.content ?? 0) + 1
    return { ...base, kind: 'code', body: toDisplay(values.content), lastLine, meta: words.lines(lastLine) }
  }
  if (tool === 'Edit' && values.old_string !== undefined) {
    const change = hunk(toDisplay(values.old_string), values.new_string === undefined ? null : toDisplay(values.new_string))
    return change.text === '' ? base : { ...base, kind: 'diff', body: change.text, meta: changeMeta(change) }
  }
  return base
}

// tool.call이 돌려준 것. core는 { result, text, isError? }, 거절은 { deny }.
export type Answer = { deny?: string; result?: unknown; text?: string; isError?: boolean }

type PatchHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: readonly string[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function isPatchHunk(value: unknown): value is PatchHunk {
  return (
    isRecord(value) &&
    typeof value.oldStart === 'number' &&
    typeof value.oldLines === 'number' &&
    typeof value.newStart === 'number' &&
    typeof value.newLines === 'number' &&
    Array.isArray(value.lines) &&
    value.lines.every(line => typeof line === 'string')
  )
}

// Edit·Write 결과의 structuredPatch를 실제 줄 번호가 붙은 diff 글로. 다 못 실어도 +/− 수는 전부 센다.
export function patchChange(patch: unknown, limit = 20000): Change | null {
  if (!Array.isArray(patch) || !patch.every(isPatchHunk) || patch.length === 0) return null
  let text = ''
  let added = 0
  let removed = 0
  for (const part of patch) {
    added += part.lines.filter(line => line.startsWith('+')).length
    removed += part.lines.filter(line => line.startsWith('-')).length
    const block = toDisplay(`@@ -${part.oldStart},${part.oldLines} +${part.newStart},${part.newLines} @@\n${part.lines.join('\n')}`, NO_LIMIT)
    if (text.length + block.length > limit) continue
    text = text === '' ? block : `${text}\n${block}`
  }
  return { text, added, removed }
}

function bashText(result: unknown, text: string): string {
  if (!isRecord(result) || typeof result.stdout !== 'string') return text
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  return stderr === '' ? result.stdout : result.stdout === '' ? stderr : `${result.stdout}\n${stderr}`
}


// 도구가 끝난 뒤의 표시: Write는 쓴 내용, Edit은 실제 줄 번호 diff, Bash는 출력과 종료 코드, 실패는 오류 글.
export function settledEntry(entry: Entry, answer: Answer, elapsedMs: number, words: Words = EN): Entry {
  const seconds = words.seconds((elapsedMs / 1000).toFixed(1))
  if (answer.deny !== undefined) {
    return { ...entry, status: 'failed', kind: 'output', body: toDisplay(answer.deny), lastLine: null, meta: words.denied }
  }
  const text = answer.text ?? ''
  if (answer.isError === true) {
    const exit = /^Exit code (\d+)/.exec(text)?.[1]
    const meta = exit === undefined ? seconds : `${seconds} · ${words.exit(exit)}`
    return { ...entry, status: 'failed', kind: 'output', body: toDisplay(text), lastLine: null, meta }
  }
  const result = answer.result
  if (entry.tool === 'Bash') {
    const isInterrupted = isRecord(result) && result.interrupted === true
    const meta = isInterrupted ? `${seconds} · ${words.interrupted}` : `${seconds} · ${words.exit('0')}`
    return { ...entry, status: 'done', kind: 'output', body: toDisplay(bashText(result, text)), lastLine: null, meta }
  }
  if (entry.tool === 'Edit' && isRecord(result)) {
    const change = patchChange(result.structuredPatch)
    if (change !== null) return { ...entry, status: 'done', kind: 'diff', body: change.text, lastLine: null, meta: changeMeta(change) }
  }
  if (entry.tool === 'Write' && isRecord(result) && typeof result.content === 'string') {
    // toDisplay처럼 CRLF·CR도 줄바꿈으로 센다. 본문 마지막 행은 끝 줄바꿈 뒤 빈 행일 수 있어 줄 수와 따로 둔다.
    const rows = result.content.split(/\r\n?|\n/)
    const lineCount = rows.length > 1 && rows.at(-1) === '' ? rows.length - 1 : rows.length
    const kind = result.type === 'create' ? words.created : words.overwritten
    return { ...entry, status: 'done', kind: 'code', body: toDisplay(result.content), lastLine: rows.length, meta: `${words.lines(lineCount)} · ${kind}` }
  }
  return { ...entry, status: 'done' }
}

// 본문 중 그릴 창: Code에 넘길 글과 첫 줄 번호, 창 위·아래로 접힌 줄 수.
export type Window = { source: string; startLine: number | undefined; above: number; below: number }

type ParsedHunk = { oldStart: number; newStart: number; lines: string[] }

function readHunks(body: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = []
  for (const line of body.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) hunks.push({ oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] })
    else hunks.at(-1)?.lines.push(line)
  }
  return hunks
}

const isOld = (line: string) => line.startsWith(' ') || line.startsWith('-')
const isNew = (line: string) => line.startsWith(' ') || line.startsWith('+')

function writeHunk(part: ParsedHunk): string {
  const header = `@@ -${part.oldStart},${part.lines.filter(isOld).length} +${part.newStart},${part.lines.filter(isNew).length} @@`
  return `${header}\n${part.lines.join('\n')}`
}

// diff를 그리는 행으로 편 것: hunk마다 머리 줄(at -1) 하나와 그 줄들.
function diffRows(hunks: readonly ParsedHunk[]): { hunk: number; at: number }[] {
  return hunks.flatMap((part, hunk) => [{ hunk, at: -1 }, ...part.lines.map((_, at) => ({ hunk, at }))])
}

// 본문이 그리는 행 수. 끝에서 얼마나 올려 볼 수 있는지 정할 때 쓴다.
export function rowCount(entry: Entry): number {
  return entry.kind === 'diff' ? diffRows(readHunks(entry.body)).length : entry.body.split('\n').length
}

// total행 중 끝에서 back행 위에서 끝나는 rows행. back이 너무 크면 맨 위에 붙는다.
function span(total: number, rows: number, back: number): { start: number; end: number } {
  const size = Math.min(total, Math.max(1, rows))
  const end = Math.min(total, Math.max(size, total - back))
  return { start: end - size, end }
}

function lineWindow(body: string, lastLine: number | null, rows: number, back: number): Window {
  const lines = body.split('\n')
  const { start, end } = span(lines.length, rows, back)
  const source = lines.slice(start, end).join('\n')
  const below = lines.length - end
  // 본문 앞이 상한으로 잘렸으면 본문 첫 줄은 1번이 아니다.
  const firstLine = lastLine === null ? 0 : lastLine - lines.length + 1
  if (firstLine < 1) return { source, startLine: undefined, above: start, below }
  return { source, startLine: firstLine + start, above: firstLine - 1 + start, below }
}

// 가운데가 잘린 hunk는 Code가 줄 번호를 못 맞추므로, 보이는 줄로 머리 숫자를 다시 쓴다.
function diffWindow(body: string, rows: number, back: number): Window {
  const hunks = readHunks(body)
  const flat = diffRows(hunks)
  const shown = span(flat.length, rows, back)
  const end = shown.end
  let start = shown.start
  // hunk 가운데서 시작하면 머리 줄을 새로 써야 하니 한 줄 덜 싣는다.
  if (flat[start]?.at !== -1 && end - start > 1) start++
  const parts: string[] = []
  for (let i = start; i < end; ) {
    const hunk = flat[i]?.hunk ?? 0
    let j = i
    while (j < end && flat[j]?.hunk === hunk) j++
    const first = Math.max(0, flat[i]?.at ?? 0)
    const last = flat[j - 1]?.at ?? -1
    const part = hunks[hunk]
    // 창 끝에 걸린 머리 줄만 있는 hunk는 그릴 줄이 없다.
    if (part !== undefined && last >= first) {
      const skipped = part.lines.slice(0, first)
      const lines = part.lines.slice(first, last + 1)
      parts.push(writeHunk({ oldStart: part.oldStart + skipped.filter(isOld).length, newStart: part.newStart + skipped.filter(isNew).length, lines }))
    }
    i = j
  }
  return { source: parts.join('\n'), startLine: undefined, above: start, below: flat.length - end }
}

// 맨 앞 호출 본문의 창: 끝에서 back행 위까지 rows행. back 0이면 끝을 따라간다.
export function bodyWindow(entry: Entry, rows: number, back: number): Window {
  return entry.kind === 'diff' ? diffWindow(entry.body, rows, back) : lineWindow(entry.body, entry.lastLine, rows, back)
}

// omp처럼 쓰는 중에는 끝 12줄, 끝나면 Write 앞 3줄·Edit 앞 12행·출력 끝 3줄만 그린다.
const STREAM_ROWS = 12
const DIFF_ROWS = 12
const FOLDED_ROWS = 3

export function shownOf(entry: Entry): Shown {
  if (entry.kind === 'none') return { source: '', startLine: null, earlier: 0, more: 0 }
  const isPending = entry.status === 'streaming' || entry.status === 'running'
  const total = rowCount(entry)
  const rows = entry.kind === 'diff' ? DIFF_ROWS : isPending && entry.kind === 'code' ? STREAM_ROWS : FOLDED_ROWS
  // 쓰는 중과 출력은 끝을, 끝난 코드·diff는 앞을 보인다.
  const isHead = !isPending && entry.kind !== 'output'
  const shown = bodyWindow(entry, rows, isHead ? Math.max(0, total - rows) : 0)
  return { source: shown.source, startLine: shown.startLine ?? null, earlier: shown.above, more: shown.below }
}
