# ClaudifestDestiny Landing Page Design

**Goal:** A single-page site that non-technical friends can open from a text message, understand what the toolkit does, and install it — without ever seeing GitHub.

**Hosting:** GitHub Pages serving from `site/` directory on master branch. Requires creating `site/index.html` and configuring GitHub Pages source (Settings > Pages > Source: Deploy from branch, `master`, `/site`).

**GitHub base URL for doc links:** `https://github.com/itsdestin/claudifest-destiny/blob/master/`

## Architecture

Single self-contained `site/index.html`. All CSS inline (no external stylesheets, no build tools, no JavaScript frameworks). Zero dependencies. Must render well on mobile (friends will open from a text message link).

## Page Sections

### 1. Hero
- Project name (ClaudifestDestiny) + tagline: "A modular toolkit that transforms Claude Code into a personal knowledge system."
- 2-sentence description with personal warmth: built for friends, shared with everyone.
- Inline link: "New to Claude Code?" → beginner's guide (same target as the Documentation card — intentionally duplicated for discoverability).

### 2. What's Inside
Four cards, one per layer:
- **Core** — Foundation hooks, specs system, memory, commands
- **Life** — Journaling, encyclopedia, Google Drive sync
- **Productivity** — Inbox processing, Todoist, text messaging
- **Modules** — Domain-specific tools (elections, fiscal notes)

Scannable — short descriptions, not paragraphs. Inline link: "Want the technical details?" → system architecture.

### 3. Install
- Tab/toggle between Mac/Linux and Windows
- **Mac/Linux command:**
  ```
  curl -fsSL https://raw.githubusercontent.com/itsdestin/claudifest-destiny/master/bootstrap/install.sh | bash
  ```
- **Windows command (PowerShell):**
  ```
  powershell -ExecutionPolicy Bypass -c "iwr -useb https://raw.githubusercontent.com/itsdestin/claudifest-destiny/master/bootstrap/install.ps1 -OutFile install.ps1; .\install.ps1"
  ```
- Below: "Then open Claude Code in your terminal and say **set me up**."
- Expandable hints (collapsed by default):
  - "What's a terminal?" → Brief: "A terminal is a program where you type commands. On Mac, search for 'Terminal.' On Linux, press Ctrl+Alt+T."
  - "What's PowerShell?" → Brief: "PowerShell is Windows' built-in command-line tool. Press the Windows key, type 'PowerShell', and press Enter."
- Minimal JS only for tab toggle and expandable hints (no frameworks)

### 4. Documentation
Grid of 4 linked cards:
| Card | Links To | Description |
|------|----------|-------------|
| Quickstart | `docs/quickstart.md` | Already use Claude Code? Start here. |
| Beginner's Guide | `docs/for-beginners/00-what-is-claude.md` | Never used Claude Code? Start here. |
| System Architecture | `docs/system-architecture.md` | Technical deep dive for power users. |
| Specs Index | `core/specs/INDEX.md` | Feature documentation and design decisions. |

All links use the full GitHub blob URL pattern: `https://github.com/itsdestin/claudifest-destiny/blob/master/<path>`.

### 5. Footer
- "Built by Destin" + GitHub repo link (`https://github.com/itsdestin/claudifest-destiny`)
- MIT license note
- Minimal, understated

## Visual Direction

- **Dark background** (`#0d1117` or similar GitHub-dark) with light text (`#e6edf3`)
- **Accent color:** Teal/cyan family (`#58a6ff` or similar) for links, card borders, highlights
- **Typography:** Monospace (system monospace stack) for code/commands, clean sans-serif (system font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`) for prose
- **Responsive:** Mobile-first. Breakpoint at `768px` — below that, cards stack single-column, install tabs stack vertically. Install command blocks use horizontal scroll if needed on very narrow screens.

## What This Page Does NOT Do
- No JavaScript frameworks or build step
- No analytics or tracking
- No signup, email capture, or cookies
- No duplicated documentation content — links to GitHub-rendered markdown
- No video (may be added later)
