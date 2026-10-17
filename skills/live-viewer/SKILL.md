---
name: live-viewer
description: The Live viewer side-pane tab is a mod in this folder that runs by itself; nothing to invoke. Use only when the user asks how to reopen the tab or change its settings.
compatibility: Claude Code with mods, tested on 2.1.295, 2.1.299 and 2.1.302 (macOS). The hooks module in hooks/ needs no other program.
license: MIT
---

# live-viewer

A mod: the hooks module in `hooks/` watches the engine's events and draws a **Live viewer** tab next to the conversation. Claude Code loads it from `~/.claude/skills/live-viewer` as `live-viewer@skills-dir` when a session starts.

- The tab opens by itself in each new session. If the user closed it, `/live` opens it again.
- It never blocks, delays or changes Claude's work. If the observer throws, it turns itself off for the rest of the session.

## Settings

Change them with `/plugin configure live-viewer@skills-dir` in a session, or from a shell with `echo '{"palette":"dark"}' | claude plugin configure live-viewer@skills-dir --values-stdin`. New sessions pick them up.

| Setting | Values | Default |
|---|---|---|
| `language` | `auto`, `en`, `ko` | `auto`: Korean when the locale or time zone is Korean |
| `palette` | `auto`, `light`, `dark` | `auto`: light in the desktop app, follows the `/config` theme in the terminal |
| `debug` | `true`, `false` | `false`: when on, writes a per-session status file under `live-viewer/status/` in the Claude config folder |
