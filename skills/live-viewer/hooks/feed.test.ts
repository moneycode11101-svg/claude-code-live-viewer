import { describe, expect, test } from 'claude-code/testing'

import { appendText, applyTodos, isHidden, lineArgs, parseRaw, RAW_LIMIT, shortPath, TEXT_LIMIT } from './feed'

const PLACES = { cwd: '/repo', home: '/home/me' }

describe('한 줄 인자', () => {
  test('Read는 경로:시작-끝, offset만 있으면 경로:시작, 둘 다 없으면 경로', () => {
    expect(lineArgs('Read', { file_path: '/repo/app/a.js', offset: 36, limit: 8 }, PLACES)).toBe('app/a.js:36-43')
    expect(lineArgs('Read', { file_path: '/repo/a.js', limit: 5 }, PLACES)).toBe('a.js:1-5')
    expect(lineArgs('Read', { file_path: '/home/me/x.md', offset: 3 }, PLACES)).toBe('~/x.md:3')
    expect(lineArgs('Read', { file_path: '/etc/hosts' }, PLACES)).toBe('/etc/hosts')
  })

  test('도구마다 주 인자, 모르는 도구·깨진 입력은 빈 글자', () => {
    expect(lineArgs('Grep', { pattern: 'foo', path: '/repo/src' }, PLACES)).toBe('foo src')
    expect(lineArgs('Glob', { pattern: '**/*.ts' }, PLACES)).toBe('**/*.ts')
    expect(lineArgs('WebFetch', { url: 'https://a.b' }, PLACES)).toBe('https://a.b')
    expect(lineArgs('WebSearch', { query: 'q' }, PLACES)).toBe('q')
    expect(lineArgs('Agent', { description: '찾기' }, PLACES)).toBe('찾기')
    expect(lineArgs('mcp__x__y', { a: 1 }, PLACES)).toBe('')
    expect(lineArgs('Read', null, PLACES)).toBe('')
  })

  test('원문은 풀어 쓰고, 상한을 넘거나 깨졌으면 빈 글자', () => {
    expect(lineArgs('Glob', parseRaw('{"pattern":"*.md"}'), PLACES)).toBe('*.md')
    expect(parseRaw('{"pattern":"*.m')).toBeNull()
    expect(parseRaw(`{"pattern":"${'x'.repeat(RAW_LIMIT)}"}`)).toBeNull()
  })

  test('세션 폴더는 상대, 홈은 ~, 그 밖은 그대로. 앱 내부 도구와 TodoWrite는 숨긴다', () => {
    expect(shortPath('/repo', PLACES)).toBe('/repo')
    expect(shortPath('/repo2/a', PLACES)).toBe('/repo2/a')
    expect(shortPath('/x', { cwd: null, home: null })).toBe('/x')
    expect([isHidden('mcp__ccd_turn__update_plan'), isHidden('TodoWrite'), isHidden('Read'), isHidden('mcp__gh__x')]).toEqual([true, true, false, false])
  })
})

describe('답·생각 글 잇기', () => {
  test('같은 종류·같은 id면 이어 붙이고, 아니면 새 항목. 항목 수와 글 길이는 상한까지', () => {
    let items = appendText([], 'thinking', 's/0', '생각', 3)
    items = appendText(items, 'thinking', 's/0', '중', 3)
    items = appendText(items, 'text', 's/1', '답', 3)
    expect(items).toEqual([
      { type: 'thinking', id: 's/0', text: '생각중' },
      { type: 'text', id: 's/1', text: '답' },
    ])
    items = appendText(items, 'text', 's/1', 'x'.repeat(TEXT_LIMIT), 3)
    expect(items.at(-1)).toEqual({ type: 'text', id: 's/1', text: 'x'.repeat(TEXT_LIMIT) })
    items = appendText(appendText(items, 'text', 't/1', 'a', 3), 'text', 't/2', 'b', 3)
    expect(items.map(item => (item.type === 'box' ? item.entry.id : item.id))).toEqual(['s/1', 't/1', 't/2'])
  })
})

describe('할 일 갱신', () => {
  const PLAN = [
    { content: '하나', status: 'in_progress' },
    { content: '둘', status: 'pending' },
    { content: '셋', status: 'pending' },
  ]
  test('TodoWrite는 통째로(activeForm 포함), update_plan items도 통째로', () => {
    expect(applyTodos([], 'TodoWrite', { todos: [{ content: '빌드', status: 'in_progress', activeForm: '빌드하는 중' }] })).toEqual([
      { content: '빌드', status: 'in_progress', activeForm: '빌드하는 중' },
    ])
    expect(applyTodos([], 'mcp__ccd_turn__update_plan', { items: PLAN, scope: 'first_task' })?.map(todo => todo.status)).toEqual(['in_progress', 'pending', 'pending'])
  })

  test('advance는 진행 중을 끝내고 다음 대기를 진행, done·start는 1부터 센 자리', () => {
    const base = applyTodos([], 'mcp__ccd_turn__update_plan', { items: PLAN }) ?? []
    expect(applyTodos(base, 'mcp__ccd_turn__update_plan', { advance: true })?.map(todo => todo.status)).toEqual(['completed', 'in_progress', 'pending'])
    expect(applyTodos(base, 'mcp__ccd_turn__update_plan', { done: [1, 2], start: 3 })?.map(todo => todo.status)).toEqual(['completed', 'completed', 'in_progress'])
  })

  test('다른 도구나 깨진 입력은 null', () => {
    expect(applyTodos([], 'Read', { todos: [] })).toBeNull()
    expect(applyTodos([], 'TodoWrite', null)).toBeNull()
    expect(applyTodos([], 'TodoWrite', { todos: 'x' })).toBeNull()
  })
})
