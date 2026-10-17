import { describe, expect, test } from 'claude-code/testing'

import { feed, initialState, type Key, type State } from './partial'

// 정답은 JSON.parse 결과에 풀이기 정책(최상위 다섯 키, 문자열만, 본문 끝·경로 앞·명령 첫 줄 앞 상한)을 적용한 값이다.
// 줄바꿈 수는 본문 키에서만, 잘린 앞부분까지 센다.
const LIMIT: Record<Key, number> = { file_path: 4096, content: 20000, old_string: 20000, new_string: 20000, command: 4096 }
const KEYS: readonly Key[] = ['file_path', 'content', 'old_string', 'new_string', 'command']
const isTail = (key: Key) => key === 'content' || key === 'old_string' || key === 'new_string'

type Expected = { values: Partial<Record<Key, string>>; truncated: Partial<Record<Key, true>>; breaks: Partial<Record<Key, number>> }

function oracle(json: string): Expected {
  const parsed = JSON.parse(json) as Record<string, unknown>
  const expected: Expected = { values: {}, truncated: {}, breaks: {} }
  for (const key of KEYS) {
    const value = parsed[key]
    if (typeof value !== 'string') continue
    const cap = LIMIT[key]
    if (isTail(key)) {
      expected.values[key] = value.slice(-cap)
      if (value.length > cap) expected.truncated[key] = true
      const breaks = value.split('\n').length - 1
      if (breaks > 0) expected.breaks[key] = breaks
      continue
    }
    const line = key === 'command' ? (value.split(/[\r\n]/)[0] ?? '') : value
    expected.values[key] = line.slice(0, cap)
    if (line.length > cap || line.length < value.length) expected.truncated[key] = true
  }
  return expected
}

function feedAll(chunks: readonly string[]): State {
  return chunks.reduce((state, chunk) => feed(state, chunk), initialState())
}

function splitEvery(text: string, size: number): string[] {
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
  return parts
}

function splitRandom(text: string, seed: number): string[] {
  const parts: string[] = []
  let state = seed
  let i = 0
  while (i < text.length) {
    state = (state * 1103515245 + 12345) % 2147483648
    const size = 1 + (state % 40)
    parts.push(text.slice(i, i + size))
    i += size
  }
  return parts
}

function expectMatches(state: State, json: string): void {
  const expected = oracle(json)
  expect(state.phase).toBe('done')
  expect(state.values).toEqual(expected.values)
  expect(state.truncated).toEqual(expected.truncated)
  expect(state.breaks).toEqual(expected.breaks)
}

const DOCUMENTS: readonly string[] = [
  '{}',
  '{"file_path":"/tmp/a.ts","content":"const a = 1\\n"}',
  '{"file_path":"/tmp/b.md","old_string":"x","new_string":"# 제목\\n\\n- 항목\\t끝"}',
  '{"command":"ls -la\\necho 둘째 줄","description":"목록"}',
  '{"command":"echo a\\rb"}',
  '{"con\\u0074ent":"이스케이프 키","file\\u005fpath":"/x"}',
  '{"content":"\\"따옴표\\" \\\\ \\/ \\b\\f\\n\\r\\t \\u00e9 \\uD83D\\uDE00 😀 끝"}',
  '{"content":"\\ud83d"}',
  '{"content":""}',
  '{"content":"첫 값","content":"나중 값"}',
  '{"old_string":"a\\nb\\n","old_string":"c","new_string":"\\n\\n\\n"}',
  '{"content":"문자열","content":42}',
  '{"content":null,"content":"되살아남"}',
  '{"content":["배열"],"file_path":{"content":"안쪽"},"command":true}',
  '{"x":{"content":"no","y":[{"command":"nested"}]},"content":"yes"}',
  '{"a":[1,-2,3.5,-0.25e+10,1E-3,0,true,false,null,{"b":[]}],"content":"뒤"}',
  ' \n\t{ "content" : "공백" , "command" : "pwd" } \n',
  '{"verylongkeyname":"x","new_string":"y"}',
]

describe('완성된 문서는 어떻게 쪼개도 정답과 같다', () => {
  test('통째·1자·3자·임의 분할', () => {
    for (const json of DOCUMENTS) {
      expectMatches(feedAll([json]), json)
      expectMatches(feedAll(splitEvery(json, 1)), json)
      expectMatches(feedAll(splitEvery(json, 3)), json)
      for (const seed of [1, 7, 42]) expectMatches(feedAll(splitRandom(json, seed)), json)
    }
  })

  test('모든 두 조각 경계(이스케이프·서로게이트 경계 포함)', () => {
    for (const json of DOCUMENTS) {
      for (let i = 0; i <= json.length; i++) expectMatches(feedAll([json.slice(0, i), json.slice(i)]), json)
    }
  })
})

test('미완성 앞부분은 invalid가 아니고, 잘못된 입력만 invalid다', () => {
  for (const json of DOCUMENTS) {
    let state = initialState()
    for (const char of json) {
      state = feed(state, char)
      expect(state.phase === 'invalid' || state.phase === 'limited').toBe(false)
    }
  }
  const broken = ['[1]', '"x"', '{"a":tr}', '{"a" 1}', '{"a":1}}', '{"a":"\\x"}', '{"a":"\u0001"}', '{"a":01}', '{"a":1,}', '{"a":"\\u12G4"}', '{,}', '{"a":-}', '{"a":1.}']
  for (const json of broken) expect(feedAll([json]).phase).toBe('invalid')
})

test('invalid가 되면 뒤 조각으로 되살아나지 않는다', () => {
  const state = feedAll(['{"content":"앞"', 'x', ',"content":"뒤"}'])
  expect(state.phase).toBe('invalid')
  expect(state.values.content).toBe('앞')
})

test('상한: 본문은 끝 20000, 경로는 앞 4096, 명령은 첫 줄 앞 4096', () => {
  const body = 'a'.repeat(15000) + 'b'.repeat(10000)
  const path = 'p'.repeat(5000)
  const json = JSON.stringify({ file_path: path, content: body, command: 'c'.repeat(4096) })
  expectMatches(feedAll(splitEvery(json, 17)), json)
  const exact = JSON.stringify({ content: 'z'.repeat(20000), file_path: 'q'.repeat(4096) })
  expectMatches(feedAll(splitEvery(exact, 23)), exact)
  expect(feedAll([exact]).truncated).toEqual({})
})

test('1MiB 단일 조각도 끝 20000만 남기고, 줄바꿈은 잘린 앞까지 센다', () => {
  const body = `${'x\n'.repeat(512 * 1024 - 3)}끝줄\n`
  const json = JSON.stringify({ content: body })
  const state = feedAll([json])
  expectMatches(state, json)
  expect(state.values.content?.length).toBe(20000)
  expect(state.breaks.content).toBe(512 * 1024 - 2)
})

test('깊이 64까지는 읽고 65에서 limited', () => {
  // 최상위 객체가 깊이 1이라 안쪽은 depth - 1겹이다.
  const nest = (depth: number) => `${'{"a":'.repeat(depth - 1)}1${'}'.repeat(depth - 1)}`
  expect(feedAll([`{"x":${nest(64)},"content":"뒤"}`]).values.content).toBe('뒤')
  const deep = feedAll([`{"x":${nest(65)},"content":"뒤"}`])
  expect(deep.phase).toBe('limited')
  expect(deep.values.content).toBeUndefined()
  const array = (depth: number) => `${'['.repeat(depth - 1)}${']'.repeat(depth - 1)}`
  expect(feedAll([`{"x":${array(64)}}`]).phase).toBe('done')
  expect(feedAll([`{"x":${array(65)}}`]).phase).toBe('limited')
})

test('이전 상태를 바꾸지 않는다', () => {
  const deepFreeze = (state: State) => {
    Object.freeze(state.values)
    Object.freeze(state.truncated)
    Object.freeze(state.closed)
    Object.freeze(state.breaks)
    return Object.freeze(state)
  }
  const before = deepFreeze(feedAll(['{"content":"앞', '부분']))
  const snapshot = JSON.stringify(before)
  const after = feed(before, '뒤","command":"ls"}')
  expect(JSON.stringify(before)).toBe(snapshot)
  expect(after.values).toEqual({ content: '앞부분뒤', command: 'ls' })
})
