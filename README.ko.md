<div align="center">

[English](README.md) · **한국어**

# live-viewer

**Claude Code가 쓰는 코드를, 쓰는 그 순간에 본다.**

Claude Code가 부르는 도구를 옆 패널 탭에 실시간으로 찍어 주는 mod입니다. 파일은 한 줄씩, 수정은 diff로, 명령은 출력과 함께 보입니다.

[![test](https://github.com/moneycode11101-svg/claude-code-live-viewer/actions/workflows/test.yml/badge.svg)](https://github.com/moneycode11101-svg/claude-code-live-viewer/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Claude Code 2.1.302](https://img.shields.io/badge/Claude%20Code-2.1.302-d97757.svg)](#지원-범위)

<img src="docs/demo.gif" width="880" alt="시연: Claude가 요청 제한기와 그 테스트를 쓰는 동안 오른쪽 Live viewer 탭에 파일이 한 줄씩 써지고, 수정이 diff로 보이고, 테스트가 돌고, 할 일 목록이 하나씩 끝난다">

<sub>이 페이지를 위해 다시 만든 예시 세션입니다. 실제 프로젝트 화면이 아닙니다.</sub>

[설치](#설치) · [보이는 것](#보이는-것) · [설정](#설정) · [작동 방식](#작동-방식)

</div>

## 왜 쓰나

Claude Code는 도구 호출이 다 만들어진 뒤에야 보여 줍니다. 긴 `Write`나 `Edit`는 그때까지 스피너만 돌고, 끝나면 대화 안에 접혀 버립니다. live-viewer는 대화 옆에 탭을 하나 열어, 모델이 아직 쓰고 있는 호출을 그대로 보여 줍니다. 파일이 자라는 모습, diff가 잡혀 가는 모습, 곧 돌 명령이 보입니다. 엉뚱한 방향으로 가면 일찍 알아채고 Esc로 멈출 수 있습니다.

## 설치

```bash
claude plugin marketplace add moneycode11101-svg/claude-code-live-viewer
```

```bash
claude plugin install live-viewer@live-viewer
```

새 Claude Code 세션을 열면 탭이 저절로 열립니다. 탭을 닫았으면 `/live`로 다시 엽니다. 로캘이 한국어이거나 시간대가 서울이면 탭 제목과 글자가 한국어(**코딩 뷰어**)로 나옵니다.

## 보이는 것

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.png">
  <img src="docs/hero-light.png" width="560" alt="Live viewer 탭: 이탤릭으로 된 Claude의 생각, 한 줄로 찍힌 Read와 Grep, diff가 든 Edit 상자, 테스트 출력이 든 Bash 상자, 테스트 파일의 끝 12줄을 쓰고 있는 Write 상자, 지금 단계가 표시된 할 일 나무">
</picture>
</p>

| 호출 | 보이는 모습 |
|---|---|
| `Write` | 파일 경로를 제목으로 단 상자. 쓰는 동안은 줄 번호와 함께 끝 12줄을, 끝나면 앞 3줄과 줄 수, 새 파일인지를 보여 줍니다 |
| `Edit` | 실제 줄 번호가 붙은 diff 상자. `[+추가 -삭제]`로 표시합니다 |
| `Bash` | 명령을 제목으로 단 상자. 끝나면 출력의 끝 3줄, 걸린 시간, 종료 코드를 보여 줍니다 |
| `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Agent` | 한 줄: `● Read src/app.ts:30-60` |
| 생각, 답 | 생각은 이탤릭, 답은 Markdown |
| 할 일 목록 | 맨 아래 나무로 `끝난 수/전체`와 지금 단계 |

상자 색은 호출 상태(진행 중·끝·실패)를 따릅니다. Esc로 끊기거나 권한이 거절된 호출도 그렇게 표시합니다. 새 호출이 오면 탭은 맨 아래를 따라갑니다. 위로 굴려 읽는 동안은 멈추고, 맨 아래로 내리거나 새 프롬프트를 보내면 다시 따라갑니다.

데스크톱 앱이 아직 탭을 놓지 않았으면, 쓰고 있는 호출의 상자를 대화창 스피너 위에 대신 그립니다.

## 설정

Claude Code 안에서 `/plugin configure live-viewer@live-viewer`를 실행하거나, 설치할 때 정합니다.

```bash
claude plugin install live-viewer@live-viewer --config palette=dark
```

| 설정 | 값 | 기본값 |
|---|---|---|
| `language` | `auto`, `en`, `ko` | `auto`: 로캘(`LC_ALL`, `LC_MESSAGES`, `LANG`)이 `ko`로 시작하거나 시간대가 `Asia/Seoul`이면 한국어, 아니면 영어 |
| `palette` | `auto`, `light`, `dark` | `auto` (데스크톱 앱은 밝게, 터미널은 테마를 따름) |
| `debug` | `true`, `false` | `false`. 켜면 Claude 설정 폴더의 `live-viewer/status/`에 세션마다 상태 파일을 씁니다 |

## 지원 범위

| | 상태 |
|---|---|
| Claude Code 2.1.302, macOS 데스크톱 앱 | 시험함 (2026-10-17) |
| 터미널의 Claude Code | 아직 시험 안 함 |
| Linux, Windows | 아직 시험 안 함 |
| 2.1.302보다 오래된 Claude Code | 시험 안 함. mod는 새 기능이라 판마다 API가 바뀝니다 |
| `claude -p` 같은 headless 실행 | 보여 줄 화면이 없어 탭을 열지 않습니다 |

## 작동 방식

live-viewer는 Claude Code mod, 곧 엔진 이벤트를 지켜보는 hooks 모듈을 가진 플러그인입니다.

- **`turn.step`**: 모델이 한 단계에서 흘려보내는 조각을 읽습니다. 조각은 하나도 바꾸지 않고 그대로 넘기고, `Write`·`Edit`·`Bash` 입력의 덜 온 JSON을 오는 대로 풀어 읽습니다.
- **`tool.call`**: 호출을 실행 중으로 바꾸고, 끝나면 결과를 붙입니다. 결과는 손대지 않고 돌려줍니다.
- **`ui.render`**: `Pane` 탭을 그리고, 탭이 놓이지 않았을 때는 `Spinner` 자리에 그립니다.

Claude가 하는 일을 막거나 늦추거나 바꾸지 않습니다. 탭 갱신은 33ms에 많아야 한 번으로 묶습니다. 3,000줄짜리 `Write`를 다시 돌려 보면 조각당 더 드는 시간은 약 0.03ms(p95)로, 뷰어를 끈 것과 같습니다. 관찰하다가 오류가 한 번이라도 나면 그 세션에서는 스스로 꺼지고, 세션은 그대로 이어집니다.

## 업데이트와 제거

```bash
claude plugin update live-viewer@live-viewer
```

```bash
claude plugin uninstall live-viewer@live-viewer
```

## 개발

```bash
git clone https://github.com/moneycode11101-svg/claude-code-live-viewer.git
```

```bash
claude plugin validate --strict .
```

```bash
claude plugin test .
```

받은 폴더에서 `claude --plugin-dir .`로 Claude Code를 열면 로컬 사본을 써 볼 수 있습니다.

## 출처

상자 모양과 밝은·어두운 팔레트는 [oh-my-pi](https://github.com/can1357/oh-my-pi)(MIT)를 따랐습니다. [NOTICE](NOTICE)를 보세요.

## 라이선스

[MIT](LICENSE)
