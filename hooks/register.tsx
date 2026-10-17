import { atom, read } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnStepChunk } from 'claude-code'

import type { Entry, Item, Todo, View } from '../types'
import { drawBox, drawView, type Layout, paletteOf } from './draw'
import { type Answer, settledEntry, shownOf, streamingEntry } from './entry'
import { toDisplay } from './display'
import { appendText, applyTodos, isHidden, isTodoTool, lineArgs, type Places, parseRaw, RAW_LIMIT, TEXT_LIMIT } from './feed'
import { feed, initialState, type State } from './partial'
import { EN, languageOf, type Words, wordsOf } from './words'

// 최우선은 세션 흐름을 멈추거나 늦추지 않는 것: 조각은 받자마자 그대로 내보내고, 관찰부는 동기로 짧게 돌며
// $ 호출은 기다리지 않는다. 관찰부가 한 번이라도 던지면 이 세션에서 관찰을 끈다.
// set은 조각마다 하면 엔진 거친 조각당 p95가 6~12ms로 늘어(replay 실측) 33ms에 한 번으로 묶는다.
// $를 받는 함수는 모두 이 파일에 둔다: Claude Code 2.1.295의 검사기는 $를 다른 파일 함수로 넘기면 mod를 싣지 않는다.
// 데스크톱은 클라이언트가 패널 자리를 알리기 전에는 패널을 놓지 않아서(2.1.299), 패널이 안 놓이면
// 대화창 맨 아래 진행 줄(Spinner) 자리에 쓰는 중인 상자를 그린다. 패널은 새로 그릴 때마다 끝에 붙고(데스크톱은 늘어나는
// 트리를 스스로 따라가지 않는다), 사람이 위로 굴리면 멈췄다가 끝까지 내리거나 새 프롬프트를 치면 다시 따라간다.

const PANE = 'live'
const CALLS = { plugin: 'live-viewer', key: 'calls' } as const
const EMPTY: View = { items: [], todos: [], isWorking: false, isOff: false, seat: 'spinner' }
const calls = atom(CALLS, EMPTY)
const PREVIEWED = new Set(['Write', 'Edit', 'Bash'])
const SEND_GAP_MS = 33
const MAX_ITEMS = 20
// 위에 붙는 패널은 그린 만큼 커지므로 본문 줄 수에 상한을 둔다. 진행 줄 자리는 대화창을 덜 밀도록 더 작게.
const PANE_ROWS_LIMIT = 60
const SPINNER_ROWS = 16
// 진행 줄 자리가 폭을 안 알려 줄 때.
const SPINNER_COLUMNS = 80
// session.start의 열기가 자리를 잡은 뒤 보이는 탭인지 본다.
const BRING_FORWARD_MS = 1000

type Call = { index: number; id: string; name: string; parser: State }
// 상자 밖 도구: 입력 원문을 RAW_LIMIT까지 모았다가 입력이 끝나면 한 줄로 푼다.
type Other = { index: number; id: string; name: string; raw: string }

// 세션(모듈)에 하나인 상태: 흐름 항목(상자는 본문 원문까지), 지금 스트리밍 중인 호출, 한 줄로 풀 상자 밖 도구,
// 경로를 줄일 곳, /config 테마(아직 안 읽었으면 undefined), 패널 자리, 보내기 상태(마지막으로 보낸 때, 보낼 것이 있는지, 남은 것을 보낼 타이머 하나).
let isOff = false
let items: Item[] = []
let live: Call | null = null
let other: Other | null = null
let todos: Todo[] = []
let isWorking = false
// 끝 따라가기: 사람이 위로 굴리면 false. 보낸 스냅숏 번호와 끝에 붙인 번호가 다를 때만 붙인다
// (붙이기가 다시 그리기를 부르므로 같은 그림에 두 번 붙이지 않는다).
let isFollowing = true
let sentSeq = 0
let followedSeq = -1
let places: Places = { cwd: null, home: null }
let theme: string | null | undefined
// 설정 값(register가 받는다): 글자 언어와 팔레트. auto 언어는 시간대로 먼저 정하고, 로캘 변수를 읽은 뒤 한 번 고친다.
let words: Words = EN
let languageChoice: unknown = 'auto'
let languageReady: Promise<void> | null = null
let paletteChoice: unknown = 'auto'
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
let isPanePlaced = false
let isClosedByPerson = false
let isCommandReady = false
let lastSentAt = Number.NEGATIVE_INFINITY
let isDirty = false
let timer: Timer | null = null

// 패널이 안 보일 때 원인을 추정 말고 엔진 답으로 가리려고, 설정 `debug`가 켜졌을 때만 세션마다 상태 파일 하나를 바꿔 쓴다:
// <CLAUDE_CONFIG_DIR 또는 ~/.claude>/live-viewer/status/<세션 id>.json. 바뀔 때만 쓰고, 쓰는 중이면 끝난 뒤 한 번 더 쓴다. 흐름은 기다리지 않는다.

const STATUS_KEEP = 12

type StatusRow = Record<string, unknown>

const status = {
  v: 1,
  updated: '',
  surfaces: null as unknown,
  opens: [] as StatusRow[],
  panes: null as unknown,
  draws: {} as Record<string, StatusRow>,
  closes: [] as StatusRow[],
  scroll: null as StatusRow | null,
  follow: null as StatusRow | null,
  errors: [] as StatusRow[],
  off: null as string | null,
}

let statusTarget: string | null = null
let isSaving = false
let isAgain = false
let isStatusBroken = false
let isStatusEnabled = false

// register가 설정 값을 받을 때마다 부른다.
function setDebug(isOn: boolean): void {
  isStatusEnabled = isOn
}

const nowIso = () => new Date().toISOString()

function keepLast(rows: StatusRow[], row: StatusRow): void {
  rows.push(row)
  if (rows.length > STATUS_KEEP) rows.splice(0, rows.length - STATUS_KEEP)
}

async function writeStatus($: EngineInterface): Promise<void> {
  if (statusTarget === null) {
    const config = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = await $.env.get('HOME')
    const base = config ?? (home === undefined ? undefined : `${home}/.claude`)
    if (base === undefined) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
    statusTarget = `${base}/live-viewer/status/${await $.session.id()}.json`
  }
  status.updated = nowIso()
  await $.fs.write(statusTarget, `${JSON.stringify(status, null, 1)}\n`)
}

function save($: EngineInterface): void {
  if (!isStatusEnabled || isStatusBroken) return
  if (isSaving) {
    isAgain = true
    return
  }
  isSaving = true
  const run = async () => {
    try {
      do {
        isAgain = false
        await writeStatus($)
      } while (isAgain)
    } catch (error) {
      // 기록은 진단일 뿐이라 관찰을 끄지 않는다. 한 번 알리고 이 세션에서는 그만 쓴다.
      isStatusBroken = true
      Promise.resolve($.ui.log(`live-viewer: could not write the status file (${String(error)})`) as unknown).catch(() => {
        // 알림까지 실패하면 더 알릴 곳이 없다.
      })
    } finally {
      isSaving = false
    }
  }
  void run()
}

function noteOpen($: EngineInterface, from: string, result: { isPlaced: boolean; reason?: string } | { error: string }): void {
  keepLast(status.opens, { at: nowIso(), from, ...result })
  save($)
}

function noteSurfaces($: EngineInterface, surfaces: unknown): void {
  if (JSON.stringify(surfaces) === JSON.stringify(status.surfaces)) return
  status.surfaces = surfaces
  save($)
}

function notePanes($: EngineInterface, panes: unknown): void {
  if (JSON.stringify(panes) === JSON.stringify(status.panes)) return
  status.panes = panes
  save($)
}

// 그리기 요청이 온 곳과 크기. 같은 값이면 쓰지 않는다(그리기는 잦다).
function noteDraw($: EngineInterface, component: string, row: StatusRow): void {
  const before = status.draws[component]
  if (before !== undefined && JSON.stringify({ ...before, at: '' }) === JSON.stringify({ ...row, at: '' })) return
  status.draws[component] = { ...row, at: nowIso() }
  save($)
}

function noteClose($: EngineInterface, origin: string): void {
  keepLast(status.closes, { at: nowIso(), origin })
  save($)
}

// 엔진 창을 끝에 붙인 결과. 데스크톱이 패널 굴리기를 받는지 보려고 남긴다. 같은 결과면 쓰지 않는다.
function noteScroll($: EngineInterface, result: { deny?: string }): void {
  const deny = result.deny ?? null
  if (status.scroll?.deny === deny) return
  status.scroll = { at: nowIso(), deny }
  save($)
}

// 사람이 패널을 굴려 끝 따라가기가 바뀐 때: 그때의 창 자리와 트리 높이.
function noteFollow($: EngineInterface, isNowFollowing: boolean, window: { offset: number; bodyRows: number; contentRows: number }): void {
  if (status.follow?.isFollowing === isNowFollowing) return
  status.follow = { at: nowIso(), isFollowing: isNowFollowing, ...window }
  save($)
}

function noteError($: EngineInterface, where: string, error: unknown): void {
  keepLast(status.errors, { at: nowIso(), where, error: String(error) })
  save($)
}

function noteOff($: EngineInterface, reason: string): void {
  status.off = reason
  save($)
}

// 터미널 팔레트를 고를 /config 테마. 처음 그릴 때 한 번 읽는다(session.start에서 읽으면 첫 그리기에 늦는다).
async function themeOf($: EngineInterface, surface: string): Promise<string | null> {
  if (surface === 'desktop') return null
  if (theme !== undefined) return theme
  try {
    const value = (await $.config.list()).find(row => row.key === 'theme')?.value
    theme = typeof value === 'string' ? value : null
  } catch (error) {
    noteError($, 'config.list', error)
    theme = null
  }
  return theme
}

function ignore(): void {
  // 끄는 중의 실패는 더 할 일이 없다. 흐름을 건드리지 않도록 버린다.
}

function turnOff($: EngineInterface, error: unknown): void {
  if (isOff) return
  isOff = true
  isDirty = false
  live = null
  try {
    timer?.cancel()
  } catch {
    ignore()
  }
  try {
    noteOff($, String(error))
  } catch {
    ignore()
  }
  try {
    // 로그 실패가 흐름을 건드리지 않게 기다리지 않고, 비동기로 거절돼도 받아 버린다.
    Promise.resolve($.ui.log(`live-viewer: turned off for this session (${String(error)})`) as unknown).catch(ignore)
  } catch {
    ignore()
  }
  try {
    $.state.set(CALLS, { ...EMPTY, isOff: true }).catch(ignore)
  } catch {
    ignore()
  }
}

function guard($: EngineInterface, work: () => void): void {
  if (isOff) return
  try {
    work()
  } catch (error) {
    turnOff($, error)
  }
}

const isStopped = (parser: State) => parser.phase === 'invalid' || parser.phase === 'limited'
const isPending = (entry: Entry) => entry.status === 'streaming' || entry.status === 'running'
const seatOf = (): View['seat'] => (isClosedByPerson ? 'hidden' : isPanePlaced ? 'pane' : 'spinner')

const boxes = () => items.flatMap(item => (item.type === 'box' ? [item.entry] : []))

// 그릴 창(shown)은 바뀔 때 한 번만 만든다: 본문(최대 2만 자)을 자르는 일이 무겁다.
function put(entry: Entry): void {
  const item: Item = { type: 'box', entry, shown: shownOf(entry) }
  const at = items.findIndex(known => known.type === 'box' && known.entry.id === entry.id)
  if (at !== -1) {
    items = items.map((known, i) => (i === at ? item : known))
    return
  }
  items = [...items, item].slice(-MAX_ITEMS)
}

function putLine(id: string, tool: string, args: string): void {
  items = [...items, { type: 'line' as const, id, tool, args }].slice(-MAX_ITEMS)
}

// 상자 밖 도구의 입력이 끝났다: 할 일 도구면 할 일을 고치고, 숨길 도구가 아니면 한 줄로 싣는다. 표시가 바뀌었으면 true.
function settleOther(): boolean {
  const done = other
  other = null
  if (done === null) return false
  if (isTodoTool(done.name)) {
    const next = applyTodos(todos, done.name, parseRaw(done.raw))
    if (next === null) return false
    todos = next
    return true
  }
  if (isHidden(done.name)) return false
  putLine(done.id, done.name, lineArgs(done.name, parseRaw(done.raw), places))
  return true
}

// 스트리밍 표시는 조각마다가 아니라 보낼 때만 다시 만든다: 본문(최대 2만 자)을 고치는 일이 무겁다.
function settleLive(): void {
  if (live !== null) put(streamingEntry(live.id, live.name, live.parser, !isStopped(live.parser), words))
}

// 상자는 그릴 창만 싣고 본문 원문은 비워 state를 작게 둔다. 글은 보낼 때 표시 사본으로 바꾼다.
function shownItem(item: Item): Item {
  if (item.type === 'box') return { ...item, entry: { ...item.entry, body: '' } }
  if (item.type === 'line') return item
  return { ...item, text: toDisplay(item.text, TEXT_LIMIT) }
}

function snapshot(): View {
  return { items: items.map(shownItem), todos, isWorking, isOff, seat: seatOf() }
}

function flush($: EngineInterface): void {
  timer?.cancel()
  timer = null
  if (isOff || !isDirty) return
  isDirty = false
  settleLive()
  lastSentAt = performance.now()
  sentSeq++
  $.state.set(CALLS, snapshot()).catch(error => turnOff($, error))
}

// 33ms가 지났으면 바로 보내고, 아니면 타이머 하나로 미룬다. 모델이 쓰다 멈춰도 마지막 글자가 늦지 않게.
function request($: EngineInterface): void {
  isDirty = true
  if (performance.now() - lastSentAt >= SEND_GAP_MS) {
    flush($)
    return
  }
  timer ??= $.clock.after(SEND_GAP_MS, () => guard($, () => flush($)))
}

// 자리가 바뀌면 진행 줄 쪽 그림을 켜고 끄는 일이라 미루지 않고 보낸다.
function setPlaced($: EngineInterface, isPlaced: boolean): void {
  if (isPlaced === isPanePlaced) return
  isPanePlaced = isPlaced
  isDirty = true
  flush($)
}

// 그린 트리가 패널보다 길어지는 화면(줄 높이를 다르게 재는 곳)에서도 새 줄이 보이게, 엔진 창을 끝에 붙인다.
// 끝에 붙은 창은 사람이 다음에 옮길 때까지 늘어나는 트리를 따라간다.
function followEnd($: EngineInterface): void {
  $.ui.scroll({ in: PANE, to: 'end' }).then(
    result => noteScroll($, result),
    error => noteError($, 'ui.scroll', error),
  )
}

// 탭 제목·명령 설명이 나가기 전에 한 번만 읽는다. 못 읽으면 시간대로 정한 글자를 그대로 쓴다.
function settleLanguage($: EngineInterface): Promise<void> {
  languageReady ??= (async () => {
    if (languageChoice === 'en' || languageChoice === 'ko') return
    const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
    words = wordsOf(languageOf(languageChoice, locale, timeZone()))
  })().catch(error => noteError($, 'language', error))
  return languageReady
}

function openPane($: EngineInterface, from: string): Promise<{ isPlaced: boolean; reason?: string } | null> {
  try {
    return $.ui.open({ id: PANE, title: words.title }).then(
      result => {
        noteOpen($, from, result)
        guard($, () => setPlaced($, result.isPlaced))
        return result
      },
      error => {
        noteOpen($, from, { error: String(error) })
        return null
      },
    )
  } catch (error) {
    noteOpen($, from, { error: String(error) })
    return Promise.resolve(null)
  }
}

// 이 mod의 탭이 다른 플러그인 탭 뒤에 숨어 있으면 한 번 닫았다 다시 연다. 닫았다 연 패널만 보이는 탭이 된다
// (2026-10-17 headless probe). session.start는 바뀐 모듈을 다시 불러올 때도 오므로 열린 세션도 업데이트 때 고쳐진다.
async function bringForward($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  const pane = panes.find(other => other.id === PANE)
  if (pane === undefined || !pane.isPlaced || panes.some(other => other.isShown) || isClosedByPerson) return
  await $.ui.close({ id: PANE })
  await openPane($, 'bring-forward')
}

// 화면이 없으면 열지 않는다. 이미 놓였거나 사람이 닫았으면 다시 열지 않는다.
async function openTabs($: EngineInterface, from: string): Promise<void> {
  try {
    if ((await $.session.surfaces()).length === 0) return
  } catch (error) {
    noteError($, 'session.surfaces', error)
    return
  }
  await settleLanguage($)
  if (!isOff && !isPanePlaced && !isClosedByPerson) await openPane($, from)
}

function prepare($: EngineInterface): void {
  try {
    $.session.surfaces().then(list => noteSurfaces($, list), ignore)
    // 경로 줄이기는 보기 좋으라고 하는 일이라 못 읽으면 전체 경로를 그대로 그린다.
    $.session.cwd().then(cwd => (places = { ...places, cwd }), ignore)
    $.env.get('HOME').then(home => (places = { ...places, home: home ?? null }), ignore)
    if (isCommandReady) return
    isCommandReady = true
    void settleLanguage($).then(() => $.command.register({ name: 'live', description: words.command }).catch(error => noteError($, 'command.register', error)))
  } catch (error) {
    noteError($, 'prepare', error)
  }
}

const isChanged = (before: State, after: State) =>
  after.values.file_path !== before.values.file_path ||
  after.values.content !== before.values.content ||
  after.values.old_string !== before.values.old_string ||
  after.values.new_string !== before.values.new_string ||
  after.values.command !== before.values.command ||
  isStopped(after)

// turn.step 호출 하나의 관찰부. step은 이 단계를 가리키는 글자(답·생각 항목 id 앞머리). replay 시험이 따로 재려고 내보낸다.
export function watcher($: EngineInterface, step = ''): (chunk: TurnStepChunk) => void {
  let call: Call | null = null

  const start = (index: number, id: string, name: string) => {
    // 새 호출이 시작되면 앞 호출의 입력은 다 왔다. 마지막 표시를 만들어 두고 놓는다.
    settleLive()
    live = null
    call = null
    if (settleOther()) request($)
    if (!PREVIEWED.has(name)) {
      other = { index, id, name, raw: '' }
      return
    }
    call = { index, id, name, parser: initialState() }
    live = call
    request($)
    // 패널 자리는 호출마다 다시 본다: 사람이 닫았거나 화면이 바뀌었을 수 있다.
    $.ui
      .panes()
      .then(panes => {
        notePanes($, panes)
        guard($, () => setPlaced($, panes.some(pane => pane.id === PANE && pane.isPlaced)))
      })
      .catch(error => turnOff($, error))
  }

  const input = (index: number, json: string) => {
    // 상한을 넘으면 더 모으지 않는다. 풀 때 넘은 것을 보고 이름만 둔다.
    if (other !== null && other.index === index && other.raw.length <= RAW_LIMIT) other.raw += json
    const current = call
    if (current === null || current.index !== index || isStopped(current.parser)) return
    const before = current.parser
    current.parser = feed(before, json)
    if (isChanged(before, current.parser)) request($)
  }

  return chunk =>
    guard($, () => {
      if (chunk.kind === 'tool') start(chunk.index, chunk.id, chunk.name)
      else if (chunk.kind === 'input') input(chunk.index, chunk.json)
      else if (chunk.kind === 'text' || chunk.kind === 'thinking') {
        if (chunk.text === '') return
        items = appendText(items, chunk.kind, `${step}/${chunk.index}`, chunk.text, MAX_ITEMS)
        request($)
      }
    })
}

function markRunning($: EngineInterface, id: string): void {
  if (live?.id === id) {
    settleLive()
    live = null
  }
  const entry = boxes().find(known => known.id === id)
  if (entry === undefined) return
  put({ ...entry, status: 'running' })
  request($)
}

function markSettled($: EngineInterface, id: string, answer: Answer, elapsedMs: number): void {
  const entry = boxes().find(known => known.id === id)
  if (entry === undefined) return
  put(settledEntry(entry, answer, elapsedMs, words))
  request($)
}

// 미리 본 호출이면 실행 중으로 바꾸고, 끝난 답을 그 호출에 붙인다. 답은 손대지 않고 그대로 돌려준다.
async function watchCall<R>($: EngineInterface, id: string | undefined, run: () => Promise<R>): Promise<R> {
  const isWatched = !isOff && id !== undefined && (live?.id === id || boxes().some(entry => entry.id === id))
  const startedAt = performance.now()
  if (isWatched) guard($, () => markRunning($, id))
  const answer = await run()
  if (isWatched) guard($, () => markSettled($, id, answer as Answer, performance.now() - startedAt))
  return answer
}

export const register: Register = (on, options) => {
  languageChoice = options.language
  languageReady = null
  words = wordsOf(languageOf(languageChoice, undefined, timeZone()))
  paletteChoice = options.palette
  setDebug(options.debug === true)
  // 화면이 붙어 있을 때만 연다. 다시 띄운 세션은 앱 화면이 붙기 전에 시작해, 그때 열면
  // 'no-surface' 오류가 사용자에게 뜬다. 그런 세션은 session.attach에서 연다.
  on('session.start', ($, e, next) => {
    void openTabs($, 'session.start')
    prepare($)
    $.clock.after(BRING_FORWARD_MS, () => void bringForward($).catch(error => noteError($, 'bring-forward', error)))
    return next(e)
  })

  on('session.attach', ($, e, next) => {
    void openTabs($, `session.attach:${e.surface}`)
    return next(e)
  })

  // 사람이 친 프롬프트에서 다시 열면 폭과 상관없이 놓인다(데스크톱은 엔진이 sdk로 받아 다를 수 있어 상태 파일로 본다).
  on('prompt.submit', ($, e, next) => {
    isFollowing = true
    void openTabs($, `prompt.submit:${e.origin.kind}`)
    prepare($)
    return next(e)
  })

  on('command.run', { command: 'live' }, async $ => {
    isClosedByPerson = false
    await settleLanguage($)
    const result = await openPane($, 'command')
    guard($, () => {
      isDirty = true
      flush($)
    })
    if (result === null) return { text: words.notOpened }
    return { text: result.isPlaced ? words.opened : words.notPlaced(result.reason ?? '-') }
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) {
      noteClose($, e.origin.kind)
      if (e.origin.kind === 'person') isClosedByPerson = true
      guard($, () => {
        isPanePlaced = false
        isDirty = true
        flush($)
      })
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId || isOff) return yield* next(e)
    guard($, () => {
      if (isWorking) return
      isWorking = true
      request($)
    })
    const observe = watcher($, `${e.turnId}/${e.index}`)
    const stream = next(e)
    try {
      for await (const chunk of stream) {
        yield chunk
        observe(chunk)
      }
    } finally {
      // 흐름이 끝나거나 끊기면 미룬 최신 것을 바로 보낸다. 이 단계의 호출 입력은 더 오지 않는다.
      guard($, () => {
        if (settleOther()) isDirty = true
        flush($)
        live = null
      })
    }
    return await stream.result
  })

  on('tool.call', { tool: 'Write' }, ($, e, next) => watchCall($, e.tool_use_id, () => next(e)))
  on('tool.call', { tool: 'Edit' }, ($, e, next) => watchCall($, e.tool_use_id, () => next(e)))
  on('tool.call', { tool: 'Bash' }, ($, e, next) => watchCall($, e.tool_use_id, () => next(e)))

  // 턴이 끝났는데 아직 쓰는 중·실행 중인 호출은 중단된 것이다(Esc, 거절 전 끊김).
  on('turn.complete', ($, e, next) => {
    if (!e.agentId) {
      guard($, () => {
        settleLive()
        live = null
        isWorking = false
        request($)
        const stopped = boxes().filter(isPending)
        if (stopped.length === 0) return
        for (const entry of stopped) put({ ...entry, status: 'failed', meta: entry.meta === '' ? words.interrupted : `${entry.meta} · ${words.interrupted}` })
        request($)
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { placement, bodyColumns, scroll } = e.props
    noteDraw($, 'Pane', { surface: e.surface, placement, bodyColumns, bodyRows: scroll.bodyRows, viewport: e.viewport ?? null })
    // 안 놓인 패널에는 ui.render가 오지 않으므로, 그리기 요청이 왔다면 놓인 것이다. 그리기 중의 state.set은 엔진이
    // 막아(그리기는 읽기만, 2026-10-17 관찰이 꺼진 원인) 다음 차례로 미룬다.
    if (!isPanePlaced) $.clock.after(0, () => guard($, () => setPlaced($, true)))
    const shown = await read($, calls)
    // 바탕은 터미널에서만 칠한다(auto 팔레트가 /config 테마를 따라 호스트 글자색과 맞는다). 데스크톱은 앱 밝기를 몰라 칠하면
    // 다크 앱에서 글자가 묻힌다. 대화 옆에 붙은 패널은 바닥까지 채우고, 프롬프트 위 패널은 그린 만큼만 칠한다.
    const pageRows = e.surface !== 'terminal' ? null : placement === 'dock' ? scroll.bodyRows : 0
    const layout: Layout = { surface: e.surface, columns: bodyColumns, rows: Math.min(PANE_ROWS_LIMIT, scroll.bodyRows), palette: paletteOf(paletteChoice, e.surface, await themeOf($, e.surface)), places, words, pageRows }
    // 새 그림이면 그린 뒤 끝에 붙인다. 그리기 중에는 엔진 호출을 미룬다(위 state.set과 같은 까닭).
    if (isFollowing && followedSeq !== sentSeq) {
      followedSeq = sentSeq
      $.clock.after(0, () => guard($, () => followEnd($)))
    }
    return drawView($.ui.resolve(e), shown, layout)
  })

  // 사람이 위로 굴리면 끝 따라가기를 멈추고, 끝까지 내리면 다시 따라간다. 굴리기 자체는 엔진에 그대로 넘긴다.
  on('ui.scroll', { requestId: PANE }, ($, e, next) => {
    if (e.origin.kind === 'person') {
      guard($, () => {
        isFollowing = e.offset >= e.contentRows - e.bodyRows
        noteFollow($, isFollowing, { offset: e.offset, bodyRows: e.bodyRows, contentRows: e.contentRows })
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    noteDraw($, 'Spinner', { surface: e.surface, viewport: e.viewport ?? null })
    const shown = await read($, calls)
    const current = shown.items.at(-1)
    if (shown.isOff || shown.seat !== 'spinner' || current?.type !== 'box' || !isPending(current.entry)) return next(e)
    const els = $.ui.resolve(e)
    const { Box } = els
    const layout: Layout = { surface: e.surface, columns: e.viewport?.columns ?? SPINNER_COLUMNS, rows: SPINNER_ROWS, palette: paletteOf(paletteChoice, e.surface, await themeOf($, e.surface)), places, words, pageRows: null }
    const spinner = await next(e)
    return (
      <Box flexDirection="column">
        {drawBox(els, current.entry, current.shown, layout)}
        {spinner}
      </Box>
    )
  })
}
