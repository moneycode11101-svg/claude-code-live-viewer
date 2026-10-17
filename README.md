<div align="center">

**English** · [한국어](README.ko.md)

# live-viewer

**See what Claude Code is writing, while it writes it.**

A Claude Code mod that streams every tool call into a side-pane tab: files line by line, edits as diffs, commands with their output.

[![test](https://github.com/moneycode11101-svg/claude-code-live-viewer/actions/workflows/test.yml/badge.svg)](https://github.com/moneycode11101-svg/claude-code-live-viewer/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Claude Code 2.1.302](https://img.shields.io/badge/Claude%20Code-2.1.302-d97757.svg)](#requirements)

<img src="docs/demo.gif" width="880" alt="Demo: Claude writes a rate limiter and its tests while the Live viewer tab on the right streams each file line by line, shows the edit as a diff, runs the tests and ticks off the todo list">

<sub>A sample session re-created for this page. Nothing on it comes from a real project.</sub>

[Install](#install) · [What you see](#what-you-see) · [Settings](#settings) · [How it works](#how-it-works)

</div>

## Why

Claude Code shows a tool call once it is complete. A long `Write` or `Edit` is a spinner until then, and the result is folded away in the transcript. live-viewer opens a tab next to the conversation that shows the call while the model is still producing it: the file growing, the diff taking shape, the command about to run. You can see a wrong turn early and press Esc before it lands.

## Install

```bash
claude plugin marketplace add moneycode11101-svg/claude-code-live-viewer
```

```bash
claude plugin install live-viewer@live-viewer
```

Start a new Claude Code session. The **Live viewer** tab opens by itself. If you close it, `/live` brings it back.

## What you see

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.png">
  <img src="docs/hero-light.png" width="560" alt="The live viewer tab: Claude's thinking in italics, Read and Grep as one-line entries, an Edit box with a diff, a Bash box with test output, a Write box streaming the last twelve lines of a test file, and a todo tree with the current step">
</picture>
</p>

| Call | Shown as |
|---|---|
| `Write` | A box titled with the file path. While it streams: the last 12 lines with line numbers. When done: the first 3 lines, the line count, and whether the file is new |
| `Edit` | A box with the diff and real line numbers, labelled `[+added -removed]` |
| `Bash` | A box titled with the command. When done: the last 3 lines of output, time and exit code |
| `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Agent` | One line: `● Read src/app.ts:30-60` |
| Thinking, answers | Thinking in italics, answers as Markdown |
| Todo list | A tree at the bottom with `done/total`, plus the current step |

Box colors follow the call's state: pending, done or failed. Calls cut off by Esc or a denied permission are marked as such. The tab stays at the end as new calls arrive. Scroll up to read something and it stops following. Scroll back to the bottom, or send a new prompt, and it follows again.

When the desktop app has not placed the tab yet, the box for the call being written is drawn above the spinner in the conversation instead.

## Settings

Run `/plugin configure live-viewer@live-viewer` inside Claude Code, or set them when you install:

```bash
claude plugin install live-viewer@live-viewer --config palette=dark
```

| Setting | Values | Default |
|---|---|---|
| `language` | `auto`, `en`, `ko` | `auto`: Korean when your locale (`LC_ALL`, `LC_MESSAGES` or `LANG`) starts with `ko` or your time zone is `Asia/Seoul`, English otherwise |
| `palette` | `auto`, `light`, `dark` | `auto` (light in the desktop app, follows your theme in the terminal) |
| `debug` | `true`, `false` | `false`. When on, writes a status file per session to `live-viewer/status/` in your Claude config folder |

## Requirements

| | Status |
|---|---|
| Claude Code 2.1.302, macOS desktop app | Tested (2026-10-17) |
| Claude Code in a terminal | Not tested yet |
| Linux, Windows | Not tested yet |
| Claude Code older than 2.1.302 | Not tested. Mods are new and their API changes between releases |
| `claude -p` and other headless runs | Nothing to show, so no tab opens |

## How it works

live-viewer is a Claude Code mod: a plugin whose hooks module watches the engine's events.

- **`turn.step`**: reads the streamed chunks of each model step. It passes every chunk on unchanged and parses the partial JSON of `Write`, `Edit` and `Bash` inputs as it arrives.
- **`tool.call`**: marks a call as running and attaches the result once it finishes. The result is returned untouched.
- **`ui.render`**: draws the `Pane` tab, and the `Spinner` slot when the tab is not placed.

It never blocks, delays or changes what Claude does. Updates to the tab are batched to at most one every 33 ms. In a replay of a 3,000-line `Write`, the time added per chunk is about 0.03 ms (p95), the same as with the viewer off. If the observer ever throws, it turns itself off for the rest of the session and the session carries on.

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
