<div align="center">

**English** · [한국어](README.ko.md)

# live-viewer

**A UI mod that lets you see the code Claude Code is writing under the hood, right as it happens.**

It streams every Claude Code tool call into a side-pane tab in real time.

1\. If you're a vibe coder, it's great for getting in the coding mood.<br>
2\. If you're a working developer who likes the official Claude Code app, it's great for peeking into the code under the hood.<br>
3\. It's pretty.

[![test](https://github.com/moneycode11101-svg/claude-code-live-viewer/actions/workflows/test.yml/badge.svg)](https://github.com/moneycode11101-svg/claude-code-live-viewer/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Claude Code 2.1.302](https://img.shields.io/badge/Claude%20Code-2.1.302-d97757.svg)](#requirements)

<img src="docs/demo.gif" width="880" alt="Demo: Claude writes a rate limiter and its tests while the Live viewer tab on the right streams each file line by line, shows the edit as a diff, runs the tests, and ticks off the todo list">

<sub>A sample session recreated for this page. Nothing in it comes from a real project.</sub>

[Install](#install) · [What you see](#what-you-see) · [Settings](#settings) · [How it works](#how-it-works)

</div>

## Why

Claude Code only shows a tool call once it is complete. Until then, a long `Write` or `Edit` is just a spinner, and the finished result is folded away in the transcript. `live-viewer` opens a tab next to the conversation that streams each call while the model is still producing it: the file growing, the diff taking shape, the command about to run. You can spot a wrong turn early and press `Esc` before it lands.

## Install

```bash
claude plugin marketplace add moneycode11101-svg/claude-code-live-viewer
```

```bash
claude plugin install live-viewer@live-viewer
```

Start a new Claude Code session. The **Live viewer** tab opens automatically. If you close it, `/live` brings it back.

## What you see

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.png">
  <img src="docs/hero-light.png" width="560" alt="The Live viewer tab: Claude's thinking in italics, Read and Grep as one-line entries, an Edit box with a diff, a Bash box with test output, a Write box streaming the last twelve lines of a test file, and a todo tree with the current step">
</picture>
</p>

| Call | Shown as |
|---|---|
| `Write` | A box titled with the file path. While streaming: the last 12 lines with line numbers. When done: the first 3 lines, total line count, and whether the file is new |
| `Edit` | A box showing the diff with real line numbers, labeled `[+added -removed]` |
| `Bash` | A box titled with the command. When done: the last 3 lines of output, duration, and exit code |
| `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Agent` | A single line: `● Read src/app.ts:30-60` |
| Thinking, answers | Thinking in italics; answers rendered as Markdown |
| Todo list | A tree at the bottom showing `done/total` and the current step |

Box colors reflect the call's state: pending, done, or failed. Calls cut off by `Esc` or blocked by a denied permission are marked accordingly. The tab auto-scrolls as new calls arrive. Scroll up to read something and it pauses; scroll back to the bottom, or send a new prompt, and it follows again.

When the desktop app has not placed the tab yet, the box for the active call is drawn above the spinner in the conversation instead.

## Settings

Run `/plugin configure live-viewer@live-viewer` inside Claude Code, or pass options when you install:

```bash
claude plugin install live-viewer@live-viewer --config palette=dark
```

| Setting | Values | Default |
|---|---|---|
| `language` | `auto`, `en`, `ko` | `auto`: Korean when your locale (`LC_ALL`, `LC_MESSAGES`, or `LANG`) starts with `ko` or your time zone is `Asia/Seoul`; English otherwise |
| `palette` | `auto`, `light`, `dark` | `auto` (light in the desktop app; follows your theme in the terminal) |
| `debug` | `true`, `false` | `false`. When enabled, writes a status file per session to `live-viewer/status/` in your Claude config folder |

## Requirements

| | Status |
|---|---|
| Claude Code 2.1.302, macOS desktop app | Tested (2026-10-17) |
| Claude Code in a terminal | Not tested yet |
| Linux, Windows | Not tested yet |
| Claude Code older than 2.1.302 | Not tested. Mods are new and their API changes between releases |
| `claude -p` and other headless runs | Nothing to show, so no tab opens |

## How it works

`live-viewer` is a Claude Code mod: a plugin whose hooks module watches the engine's events.

- **`turn.step`**: reads the streamed chunks of each model step. It passes every chunk on unchanged and parses the partial JSON of `Write`, `Edit`, and `Bash` inputs as it arrives.
- **`tool.call`**: marks a call as running and attaches the result once it finishes. The result is returned untouched.
- **`ui.render`**: draws the `Pane` tab, or falls back to the `Spinner` slot when the tab is not placed.

It never blocks, delays, or changes what Claude does. Updates to the tab are batched to at most one every 33 ms. In a replay of a 3,000-line `Write`, the time added per chunk is about 0.03 ms (p95)—the same as with the viewer off. If the observer ever throws, it turns itself off for the rest of the session and your session carries on uninterrupted.

## Update and remove

```bash
claude plugin update live-viewer@live-viewer
```

```bash
claude plugin uninstall live-viewer@live-viewer
```

## Development

```bash
git clone https://github.com/moneycode11101-svg/claude-code-live-viewer.git
```

```bash
claude plugin validate --strict .
```

```bash
claude plugin test .
```

To try a local checkout, start Claude Code with `claude --plugin-dir .` from the repo folder.

## Credits

The box layout and the light and dark palettes follow [oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT). See [NOTICE](NOTICE).

## License

[MIT](LICENSE)
