# DestinClaude

**Website:** https://itsdestin.github.io/destinclaude/

**A modular toolkit that transforms Claude Code into a personal knowledge system, journal, task manager, and more.**

DestinClaude is a collection of skills, hooks, commands, and tools for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — Anthropic's CLI for Claude. It adds a journaling system, a living encyclopedia of your life, task management, text messaging, and domain-specific modules — all through plain-English conversation.

<!-- TODO: Add demo GIF/screenshot here -->

## Get Started

Choose your path:

### New to Claude Code?
Start with the [Beginner's Guide](docs/for-beginners/00-what-is-claude.md) — it explains everything from scratch, no technical knowledge required.

### Already Use Claude Code?
See the [Quickstart](docs/quickstart.md) — four commands and you're done.

### Returning User on a New Device?
The setup wizard will ask if you have a backup and walk you through restoring it. Just run the installer or `/setup-wizard` and answer the first question.

### Want the Deep Dive?
Read the [System Architecture](docs/system-architecture.md) for the full technical breakdown.

## Install

Copy-paste one of these into your terminal — it handles everything automatically.

**Mac/Linux (Terminal):**
```bash
curl -fsSL https://raw.githubusercontent.com/itsdestin/destinclaude/master/bootstrap/install.sh -o /tmp/install.sh && bash /tmp/install.sh
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/itsdestin/destinclaude/master/bootstrap/install.ps1 -OutFile install.ps1; powershell -ExecutionPolicy Bypass -File install.ps1
```

<details>
<summary>Already have Claude Code? Manual install instead</summary>

```bash
git clone https://github.com/itsdestin/destinclaude.git ~/.claude/plugins/destinclaude
claude
> /setup-wizard
```
</details>

## What's Inside

### Core (Foundation)
- **Session hooks** — Auto-sync, statusline, write guards, worktree guard
- **Specs system** — Structured documentation that persists across conversations
- **Memory templates** — Organized persistent memory for Claude
- **Commands** — `/setup-wizard`, `/update`, `/appupdate`, `/health`, `/sync`, `/diagnose`, `/restore`, `/contribute`, `/toolkit-uninstall`, `/theme-builder`
- **Contribution detector** — Notices your improvements, offers to share them upstream
- **DestinCode desktop app** — Electron GUI with themes, model cycling, skill marketplace, first-run installer, remote access, session resume, and multi-session management
- **Theme system** — 4 built-in themes + custom theme packs with particles, patterns, mascots, and icon overrides. Build your own with `/theme-builder`
- **Model cycling** — Switch between Claude models (Opus, Sonnet, Haiku) from the status bar
- **Remote setup** — Guided `/remote-setup` skill configures Tailscale and remote access for phone/tablet use
- **Android support** — Platform-aware UI with touch adaptations and remote desktop mode

### Life (Personal Knowledge)
- **Journaling assistant** — Conversational daily journaling with Socratic prompts
- **Encyclopedia system** — A living biography built from 8 modular source files
- **Personal data sync** — Automated backup via Google Drive, GitHub, or iCloud; `/sync` shows status and resolves warnings

### Productivity (Task Management)
- **Claude's Inbox** — Processes notes and tasks from any configured source (Todoist, Drive, Gmail, Apple Notes, and more)
- **Skill creator** — Build, test, and benchmark new skills
- **Text messaging** — Read and send SMS/RCS through Claude (via Google Messages)

### Modules (Optional Add-ons)
Optional domain-specific add-ons. See `/toolkit` for available modules.

## How It Works

Each layer is a standalone [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code/plugins). Install what you need:

| Layer | Depends On | What It Adds |
|-------|-----------|-------------|
| Core | Nothing | Foundation — hooks, specs, memory, commands |
| Life | Core | Journaling, encyclopedia, Drive sync |
| Productivity | Core | Inbox processing, messaging, skill tools |
| Modules | Nothing | Domain-specific tools (fully independent) |

The setup wizard (`/setup-wizard`) handles layer selection, conflict resolution with your existing setup, dependency installation, and personalization. Everything is non-destructive — your existing configuration is backed up and can be restored with `/toolkit-uninstall`.

## See What You Can Do

After setup, type `/toolkit` to see all your features, useful phrases, and available modules:

```
/toolkit
```

Claude shows you everything installed, plus modules you haven't added yet.

## Keeping Up to Date

The statusline shows your version and flags available updates. To update:

```
/update
```

## Contributing

Report bugs or request features via [GitHub Issues](https://github.com/itsdestin/destinclaude/issues). See the [Contributing Guide](docs/contributing.md) for details, or just type `/contribute` and Claude handles the rest.

## Built By

Created by [Destin](https://github.com/itsdestin) — originally as a personal system, now shared for anyone who wants to make Claude Code genuinely useful for daily life.

Contributions welcome. MIT licensed.
