import type { EngineInterface } from 'claude-code'

// 패널이 안 보일 때 원인을 추정 말고 엔진 답으로 가리려고, 설정 `debug`가 켜졌을 때만 세션마다 상태 파일 하나를 바꿔 쓴다:
// <CLAUDE_CONFIG_DIR 또는 ~/.claude>/live-viewer/status/<세션 id>.json. 바뀔 때만 쓰고, 쓰는 중이면 끝난 뒤 한 번 더 쓴다. 흐름은 기다리지 않는다.

const KEEP = 12

type Row = Record<string, unknown>

const status = {
  v: 1,
  updated: '',
  surfaces: null as unknown,
  opens: [] as Row[],
  panes: null as unknown,
  draws: {} as Record<string, Row>,
  closes: [] as Row[],
  scroll: null as Row | null,
  follow: null as Row | null,
  errors: [] as Row[],
  off: null as string | null,
}

let target: string | null = null
let saving = false
let again = false
let isBroken = false
let isEnabled = false

// register가 설정 값을 받을 때마다 부른다.
export function setDebug(isOn: boolean): void {
  isEnabled = isOn
}

const now = () => new Date().toISOString()

function keepLast(rows: Row[], row: Row): void {
  rows.push(row)
  if (rows.length > KEEP) rows.splice(0, rows.length - KEEP)
}

async function write($: EngineInterface): Promise<void> {
  if (target === null) {
    const config = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = await $.env.get('HOME')
    const base = config ?? (home === undefined ? undefined : `${home}/.claude`)
    if (base === undefined) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set')
    target = `${base}/live-viewer/status/${await $.session.id()}.json`
  }
  status.updated = now()
  await $.fs.write(target, `${JSON.stringify(status, null, 1)}\n`)
}

function save($: EngineInterface): void {
  if (!isEnabled || isBroken) return
  if (saving) {
    again = true
    return
  }
  saving = true
  const run = async () => {
    try {
      do {
        again = false
        await write($)
      } while (again)
    } catch (error) {
      // 기록은 진단일 뿐이라 관찰을 끄지 않는다. 한 번 알리고 이 세션에서는 그만 쓴다.
      isBroken = true
      Promise.resolve($.ui.log(`live-viewer: could not write the status file (${String(error)})`) as unknown).catch(() => {
        // 알림까지 실패하면 더 알릴 곳이 없다.
      })
    } finally {
      saving = false
    }
  }
  void run()
}

export function noteOpen($: EngineInterface, from: string, result: { isPlaced: boolean; reason?: string } | { error: string }): void {
  keepLast(status.opens, { at: now(), from, ...result })
  save($)
}

export function noteSurfaces($: EngineInterface, surfaces: unknown): void {
  if (JSON.stringify(surfaces) === JSON.stringify(status.surfaces)) return
  status.surfaces = surfaces
  save($)
}

export function notePanes($: EngineInterface, panes: unknown): void {
  if (JSON.stringify(panes) === JSON.stringify(status.panes)) return
  status.panes = panes
  save($)
}

// 그리기 요청이 온 곳과 크기. 같은 값이면 쓰지 않는다(그리기는 잦다).
export function noteDraw($: EngineInterface, component: string, row: Row): void {
  const before = status.draws[component]
  if (before !== undefined && JSON.stringify({ ...before, at: '' }) === JSON.stringify({ ...row, at: '' })) return
  status.draws[component] = { ...row, at: now() }
  save($)
}

export function noteClose($: EngineInterface, origin: string): void {
  keepLast(status.closes, { at: now(), origin })
  save($)
}

// 엔진 창을 끝에 붙인 결과. 데스크톱이 패널 굴리기를 받는지 보려고 남긴다. 같은 결과면 쓰지 않는다.
export function noteScroll($: EngineInterface, result: { deny?: string }): void {
  const deny = result.deny ?? null
  if (status.scroll?.deny === deny) return
  status.scroll = { at: now(), deny }
  save($)
}

// 사람이 패널을 굴려 끝 따라가기가 바뀐 때: 그때의 창 자리와 트리 높이.
export function noteFollow($: EngineInterface, isFollowing: boolean, window: { offset: number; bodyRows: number; contentRows: number }): void {
  if (status.follow?.isFollowing === isFollowing) return
  status.follow = { at: now(), isFollowing, ...window }
  save($)
}

export function noteError($: EngineInterface, where: string, error: unknown): void {
  keepLast(status.errors, { at: now(), where, error: String(error) })
  save($)
}

export function noteOff($: EngineInterface, reason: string): void {
  status.off = reason
  save($)
}
