import { expect, test } from 'claude-code/testing'

import { BODY_LIMIT, toDisplay } from './display'

test('CRLF·CR은 LF로, 탭·LF는 그대로', () => {
  expect(toDisplay('a\r\nb\rc\nd\te')).toBe('a\nb\nc\nd\te')
})

test('그 밖의 제어문자는 보이는 \\uXXXX 글자로', () => {
  expect(toDisplay('a\bb\u0000c\u001bd\u007fe\u0085')).toBe('a\\u0008b\\u0000c\\u001bd\\u007fe\\u0085')
})

test('끝의 반쪽 서로게이트는 보류하고, 짝이 오면 보인다', () => {
  expect(toDisplay('웃음\ud83d')).toBe('웃음')
  expect(toDisplay('웃음😀')).toBe('웃음😀')
})

test('가운데 고립 서로게이트는 U+FFFD', () => {
  expect(toDisplay('a\ud83db')).toBe('a�b')
  expect(toDisplay('a\ude00b')).toBe('a�b')
})

test('바꾼 뒤 다시 끝 20000자로 자르고, 잘린 앞의 반쪽 서로게이트는 버린다', () => {
  const expanded = toDisplay('\u0001'.repeat(BODY_LIMIT))
  expect(expanded.length).toBe(BODY_LIMIT)
  expect(expanded.endsWith('\\u0001')).toBe(true)
  const pairs = toDisplay(`x${'😀'.repeat(BODY_LIMIT / 2)}`)
  expect(pairs.length).toBe(BODY_LIMIT)
  const odd = toDisplay(`x${'😀'.repeat(BODY_LIMIT)}`, 5)
  expect(odd).toBe('😀😀')
})
