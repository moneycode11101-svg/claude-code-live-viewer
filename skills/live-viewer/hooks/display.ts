// 풀이기 값(원문 UTF-16)을 Text·Code·Markdown이 받는 글자로 바꾼다. 탭·줄바꿈 말고는 제어문자가 없어야 한다.
export const BODY_LIMIT = 20000

// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 찾아 바꾸는 것이 이 정규식의 일이다
const NEEDS_FIX = /[\r\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: 위와 같다
const FIXES = /\r\n?|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

function fix(match: string): string {
  if (match.charAt(0) === '\r') return '\n'
  const code = match.charCodeAt(0)
  if (isHigh(code) || isLow(code)) return '\ufffd'
  return `\\u${code.toString(16).padStart(4, '0')}`
}

export function toDisplay(raw: string, limit = BODY_LIMIT): string {
  // 끝의 짝 없는 high는 다음 조각에서 짝이 올 수 있어 이번에는 보이지 않는다.
  const held = isHigh(raw.charCodeAt(raw.length - 1)) ? raw.slice(0, -1) : raw
  const text = NEEDS_FIX.test(held) ? held.replace(FIXES, fix) : held
  if (text.length <= limit) return text
  const cut = text.slice(-limit)
  return isLow(cut.charCodeAt(0)) ? cut.slice(1) : cut
}
