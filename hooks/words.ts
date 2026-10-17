// 사용자에게 보이는 글자. 설정 `language`(auto 기본, en, ko)로 고른다. omp에서 온 상자 안 글자(streaming·earlier lines·TODO)는 두 언어 모두 영어로 둔다.

export type Words = {
  title: string
  command: string
  empty: string
  off: string
  opened: string
  notPlaced: (reason: string) => string
  notOpened: string
  lines: (count: number) => string
  seconds: (text: string) => string
  exit: (code: string) => string
  created: string
  overwritten: string
  interrupted: string
  denied: string
}

export const EN: Words = {
  title: 'Live viewer',
  command: 'Open the live viewer tab (tool calls as Claude writes them)',
  empty: 'Tool calls show up here as Claude writes them.',
  off: 'live-viewer: turned off for this session after an error',
  opened: 'Opened the live viewer tab.',
  notPlaced: reason => `The live viewer tab is not placed yet: ${reason}`,
  notOpened: 'Could not open the live viewer tab. Turn on the debug option to record why.',
  lines: count => `${count} ${count === 1 ? 'line' : 'lines'}`,
  seconds: text => `${text}s`,
  exit: code => `exit ${code}`,
  created: 'new file',
  overwritten: 'overwritten',
  interrupted: 'interrupted',
  denied: 'denied',
}

export const KO: Words = {
  title: '코딩 뷰어',
  command: '코딩 뷰어 탭을 연다(Claude가 쓰는 도구 호출을 실시간으로)',
  empty: 'Claude가 도구를 부르면 여기 실시간으로 찍힌다',
  off: 'live-viewer: 오류로 이 세션에서 관찰을 껐다',
  opened: '코딩 뷰어 탭을 열었다.',
  notPlaced: reason => `코딩 뷰어가 아직 화면에 안 놓였다: ${reason}`,
  notOpened: '코딩 뷰어를 열지 못했다. 까닭을 남기려면 debug 설정을 켠다.',
  lines: count => `${count}줄`,
  seconds: text => `${text}초`,
  exit: code => `종료 ${code}`,
  created: '새 파일',
  overwritten: '덮어씀',
  interrupted: '중단됨',
  denied: '거절됨',
}

export type Language = 'en' | 'ko'

// auto는 로캘(LC_ALL → LC_MESSAGES → LANG 중 먼저 있는 것)이 ko로 시작하거나 시간대가 Asia/Seoul이면 한국어다.
// 데스크톱 앱이 띄운 CLI에는 로캘 변수가 없고 Intl 로캘은 en-US로 고정이라(2026-10-17 확인) 시간대도 본다.
export function languageOf(choice: unknown, locale: string | undefined, timeZone: string | undefined): Language {
  if (choice === 'en' || choice === 'ko') return choice
  if (locale?.toLowerCase().startsWith('ko') === true) return 'ko'
  return timeZone === 'Asia/Seoul' ? 'ko' : 'en'
}

export const wordsOf = (language: Language): Words => (language === 'ko' ? KO : EN)
