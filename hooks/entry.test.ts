import { describe, expect, test } from 'claude-code/testing'

import type { Entry } from '../types'
import { bodyWindow, changeMeta, hunk, patchChange, rowCount, settledEntry, shownOf } from './entry'
import { KO } from './words'

const BASE: Entry = { id: 'c1', tool: 'Write', status: 'running', title: '/tmp/a.ts', path: '/tmp/a.ts', kind: 'code', body: '', lastLine: null, meta: '' }

describe('hunk: 쓰는 중인 Edit의 old·new로 만든 diff', () => {
  test('같은 앞뒤 줄은 3줄까지 문맥으로 두고 가운데만 -/+', () => {
    const before = ['1', '2', '3', '4', '5', 'old', '7', '8'].join('\n')
    const after = ['1', '2', '3', '4', '5', 'new', 'more', '7', '8'].join('\n')
    expect(hunk(before, after)).toEqual({ text: '@@ -3,6 +3,7 @@\n 3\n 4\n 5\n-old\n+new\n+more\n 7\n 8', added: 2, removed: 1 })
  })

  test('new가 아직 안 왔으면 old가 모두 빠진 것으로 그린다', () => {
    expect(hunk('x\ny\n', null)).toEqual({ text: '@@ -1,2 +1,0 @@\n-x\n-y', added: 0, removed: 2 })
  })

  test('둘 다 비었으면 그릴 것이 없다', () => {
    expect(hunk('', '')).toEqual({ text: '', added: 0, removed: 0 })
  })
})

describe('patchChange: 끝난 Edit의 structuredPatch', () => {
  const PATCH = [
    { oldStart: 5, oldLines: 3, newStart: 5, newLines: 3, lines: [' a', '-b', '+B', ' c'] },
    { oldStart: 40, oldLines: 1, newStart: 40, newLines: 2, lines: [' x', '+y'] },
  ]

  test('실제 줄 번호가 붙은 hunk들과 +/− 수', () => {
    expect(patchChange(PATCH)).toEqual({ text: '@@ -5,3 +5,3 @@\n a\n-b\n+B\n c\n@@ -40,1 +40,2 @@\n x\n+y', added: 2, removed: 1 })
  })

  test('상한을 넘는 hunk는 빼도 +/− 수는 전부 센다', () => {
    expect(patchChange(PATCH, 30)).toEqual({ text: '@@ -5,3 +5,3 @@\n a\n-b\n+B\n c', added: 2, removed: 1 })
  })

  test('모양이 다르거나 비었으면 null', () => {
    expect(patchChange([])).toBeNull()
    expect(patchChange([{ oldStart: 1 }])).toBeNull()
    expect(patchChange('patch')).toBeNull()
  })
})

describe('settledEntry: 도구가 끝난 뒤의 표시', () => {
  test('거절은 실패, 본문은 거절 까닭', () => {
    expect(settledEntry(BASE, { deny: '막음' }, 10)).toEqual({ ...BASE, status: 'failed', kind: 'output', body: '막음', lastLine: null, meta: 'denied' })
  })

  test('language ko는 한국어 덧말', () => {
    const bash: Entry = { ...BASE, tool: 'Bash', kind: 'none', path: null }
    expect(settledEntry(bash, { result: { stdout: '', stderr: '', interrupted: false }, text: '' }, 200, KO).meta).toBe('0.2초 · 종료 0')
    expect(settledEntry(BASE, { result: { type: 'create', content: 'a\nb\n' }, text: '' }, 5, KO).meta).toBe('2줄 · 새 파일')
  })

  test('오류는 실패, 종료 코드가 있으면 덧말에', () => {
    const bash: Entry = { ...BASE, tool: 'Bash', title: 'false', path: null, kind: 'none' }
    const failed = settledEntry(bash, { result: {}, text: 'Exit code 2\nboom', isError: true }, 1530)
    expect(failed).toEqual({ ...bash, status: 'failed', kind: 'output', body: 'Exit code 2\nboom', lastLine: null, meta: '1.5s · exit 2' })
    expect(settledEntry(BASE, { result: {}, text: 'EACCES', isError: true }, 40).meta).toBe('0.0s')
  })

  test('Bash는 표준 출력 뒤에 표준 오류, 끊겼으면 중단됨', () => {
    const bash: Entry = { ...BASE, tool: 'Bash', title: 'ls', path: null, kind: 'none' }
    const done = settledEntry(bash, { result: { stdout: 'a\n', stderr: 'warn', interrupted: false }, text: '' }, 200)
    expect(done).toEqual({ ...bash, status: 'done', kind: 'output', body: 'a\n\nwarn', lastLine: null, meta: '0.2s · exit 0' })
    expect(settledEntry(bash, { result: { stdout: '', stderr: '', interrupted: true }, text: '' }, 200).meta).toBe('0.2s · interrupted')
  })

  test('Edit은 실제 줄 번호 diff', () => {
    const edit: Entry = { ...BASE, tool: 'Edit', kind: 'diff', body: '@@ -1,1 +1,1 @@\n-b\n+B' }
    const patch = [{ oldStart: 5, oldLines: 3, newStart: 5, newLines: 3, lines: [' a', '-b', '+B', ' c'] }]
    expect(settledEntry(edit, { result: { structuredPatch: patch }, text: '' }, 5)).toEqual({
      ...edit,
      status: 'done',
      body: '@@ -5,3 +5,3 @@\n a\n-b\n+B\n c',
      lastLine: null,
      meta: '[+1 -1]',
    })
  })

  test('Write는 쓴 내용과 줄 수(끝 줄바꿈은 줄이 아니다), 새 파일·덮어씀', () => {
    const created = settledEntry(BASE, { result: { type: 'create', content: 'a\r\nb\n' }, text: '' }, 5)
    expect(created).toEqual({ ...BASE, status: 'done', kind: 'code', body: 'a\nb\n', lastLine: 3, meta: '2 lines · new file' })
    expect(settledEntry(BASE, { result: { type: 'update', content: 'x' }, text: '' }, 5).meta).toBe('1 line · overwritten')
  })
})

describe('bodyWindow: 끝을 따라가고 굴려 올린 만큼 멈춘 창', () => {
  const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `l${from + i}`).join('\n')
  const code: Entry = { ...BASE, body: lines(1, 10), lastLine: 10 }

  test('back 0이면 끝 rows줄과 그 첫 줄 번호', () => {
    expect(bodyWindow(code, 4, 0)).toEqual({ source: lines(7, 10), startLine: 7, above: 6, below: 0 })
  })

  test('back만큼 올리고, 너무 올리면 맨 위에 붙는다', () => {
    expect(bodyWindow(code, 4, 3)).toEqual({ source: lines(4, 7), startLine: 4, above: 3, below: 3 })
    expect(bodyWindow(code, 4, 100)).toEqual({ source: lines(1, 4), startLine: 1, above: 0, below: 6 })
  })

  test('앞이 잘린 본문은 실제 줄 번호로 센다', () => {
    const tail: Entry = { ...BASE, body: lines(91, 100), lastLine: 100 }
    expect(bodyWindow(tail, 3, 0)).toEqual({ source: lines(98, 100), startLine: 98, above: 97, below: 0 })
  })

  test('줄 번호가 없는 출력', () => {
    const output: Entry = { ...BASE, kind: 'output', body: lines(1, 5), lastLine: null }
    expect(bodyWindow(output, 2, 1)).toEqual({ source: lines(3, 4), startLine: undefined, above: 2, below: 1 })
  })

  describe('diff는 잘린 hunk의 머리 숫자를 보이는 줄로 다시 쓴다', () => {
    const diff: Entry = { ...BASE, kind: 'diff', body: '@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10,2 +10,3 @@\n x\n+y\n z' }

    test('행 수는 머리 줄 포함', () => {
      expect(rowCount(diff)).toBe(8)
      expect(rowCount(code)).toBe(10)
    })

    test('끝 hunk가 창에 꼭 맞으면 그대로', () => {
      expect(bodyWindow(diff, 4, 0)).toEqual({ source: '@@ -10,2 +10,3 @@\n x\n+y\n z', startLine: undefined, above: 4, below: 0 })
    })

    test('hunk 가운데서 시작하면 한 줄 덜 싣고 머리를 새로 쓴다', () => {
      expect(bodyWindow(diff, 3, 0)).toEqual({ source: '@@ -11,1 +11,2 @@\n+y\n z', startLine: undefined, above: 6, below: 0 })
    })

    test('두 hunk에 걸친 창', () => {
      expect(bodyWindow(diff, 4, 2)).toEqual({ source: '@@ -3,0 +2,1 @@\n+B\n@@ -10,1 +10,1 @@\n x', startLine: undefined, above: 3, below: 2 })
    })

    test('다 들어가면 본문 그대로', () => {
      expect(bodyWindow(diff, 20, 0)).toEqual({ source: diff.body, startLine: undefined, above: 0, below: 0 })
    })
  })
})

describe('omp식 창(shownOf)', () => {
  const LINES = Array.from({ length: 50 }, (_, i) => `l${i + 1}`).join('\n')
  const write: Entry = { id: 'w', tool: 'Write', status: 'streaming', title: '/tmp/a.ts', path: '/tmp/a.ts', kind: 'code', body: LINES, lastLine: 50, meta: '50줄' }

  test('쓰는 중은 끝 12줄과 앞 줄 수, 끝나면 앞 3줄과 뒤 줄 수', () => {
    expect(shownOf(write)).toEqual({ source: LINES.split('\n').slice(38).join('\n'), startLine: 39, earlier: 38, more: 0 })
    expect(shownOf({ ...write, status: 'done' })).toEqual({ source: 'l1\nl2\nl3', startLine: 1, earlier: 0, more: 47 })
  })

  test('출력은 끝 3줄, 끝난 diff는 앞 12행, 본문 없으면 빈 창', () => {
    const bash: Entry = { ...write, tool: 'Bash', status: 'done', kind: 'output', body: 'a\nb\nc\nd', lastLine: null }
    expect(shownOf(bash)).toEqual({ source: 'b\nc\nd', startLine: null, earlier: 1, more: 0 })
    const diff = ['@@ -1,20 +1,20 @@', ...Array.from({ length: 20 }, (_, i) => ` c${i}`)].join('\n')
    const shown = shownOf({ ...write, tool: 'Edit', status: 'done', kind: 'diff', body: diff, lastLine: null })
    expect(shown.source.split('\n')).toHaveLength(12)
    expect(shown.more).toBe(9)
    expect(shownOf({ ...write, kind: 'none', body: '' })).toEqual({ source: '', startLine: null, earlier: 0, more: 0 })
  })

  test('Edit 꼬리는 0인 쪽을 뺀다', () => {
    expect([changeMeta({ text: '', added: 3, removed: 1 }), changeMeta({ text: '', added: 2, removed: 0 }), changeMeta({ text: '', added: 0, removed: 0 })]).toEqual(['[+3 -1]', '[+2]', ''])
  })
})
