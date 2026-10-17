// 패널(또는 패널이 안 놓였을 때 대화창 맨 아래 진행 줄)이 그리는 표시 스냅숏.
// 풀이기 상태는 넣지 않는다(turn.step 호출의 지역 변수). 글자는 모두 toDisplay를 거친 표시용이다.
export type Status = 'streaming' | 'running' | 'done' | 'failed'

// 도구 호출 하나: 상자 윗줄(상태·도구·제목·꼬리)과 본문 하나.
export type Entry = {
  // tool_use id. tool.call 결과를 이 호출에 붙일 때 쓴다.
  id: string
  tool: string
  status: Status
  // Write·Edit은 경로, Bash는 명령 첫 줄. 아직 안 왔으면 빈 글자.
  title: string
  // 강조 언어를 고를 경로. 없으면 null.
  path: string | null
  // code: 줄 번호 붙은 코드, diff: unified diff hunk, output: 명령 출력·오류 글, none: 본문 없음.
  kind: 'code' | 'diff' | 'output' | 'none'
  body: string
  // code 본문 마지막 줄의 번호. 모르면 null(줄 번호를 안 그린다).
  lastLine: number | null
  // 윗줄 끝 꼬리(12줄, [+3 -1], 0.4초 · 종료 1).
  meta: string
}

// 상자 본문 중 그릴 창: Code에 넘길 글, 첫 줄 번호(모르면 null), 창 위·아래로 접힌 줄 수.
export type Shown = { source: string; startLine: number | null; earlier: number; more: number }

// 흐름의 한 항목. box는 Write·Edit·Bash 상자(본문은 shown에만 싣고 entry.body는 비운다), line은 그 밖 도구 한 줄,
// text·thinking은 답과 생각 글(같은 단계·같은 블록 index면 한 항목에 이어 붙인다).
export type Item =
  | { type: 'box'; entry: Entry; shown: Shown }
  | { type: 'line'; id: string; tool: string; args: string }
  | { type: 'text' | 'thinking'; id: string; text: string }

// 할 일 하나(TodoWrite·update_plan). activeForm은 TodoWrite만 준다.
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string | null }

export type View = {
  // 오래된 것이 앞.
  items: readonly Item[]
  // 맨 아래 할 일 나무. 턴이 도는 동안(isWorking)은 진행 중 할 일을 진행 줄로도 단다.
  todos: readonly Todo[]
  isWorking: boolean
  isOff: boolean
  // 어디에 그리나: pane은 패널, spinner는 패널이 안 놓여 대화창 맨 아래 진행 줄 자리,
  // hidden은 사람이 패널을 손으로 닫아 아무 데도(/live로 다시 연다).
  seat: 'pane' | 'spinner' | 'hidden'
}

declare module 'claude-code' {
  interface PluginState {
    'live-viewer': { calls: View }
  }
}
