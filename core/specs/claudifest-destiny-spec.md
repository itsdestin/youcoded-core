# ClaudifestDestiny Toolkit — Spec

**Version:** 1.0
**Last updated:** 2026-03-16
**Feature location:** `~/.claude/plugins/claudifest-destiny/` (toolkit root)

## Purpose

Canonical reference for the ClaudifestDestiny toolkit as a published, installable product. Documents the bootstrap/install flow, setup wizard behavior, component registration mechanism, dependency chain, and known gaps between the author's desktop environment and what the toolkit actually configures during installation.

Individual features (skills, hooks, MCP servers) have their own specs — this spec covers the toolkit-level view: how it gets onto a user's machine and what works (and doesn't) after setup.

## User Mandates

- (2026-03-16) The bootstrap installer and setup wizard must be non-destructive — never overwrite, delete, or modify existing user files without explicit permission. Always back up before changing anything.
- (2026-03-16) Component registration must use symlinks into `~/.claude/skills/`, `~/.claude/commands/`, and `~/.claude/hooks/` — NOT `enabledPlugins` path-based entries, which are silently ignored by Claude Code.

## Design Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|----------------------|
| Symlink-based registration (not plugin marketplace) | Claude Code's `enabledPlugins` only supports `"name@marketplace": true` format. Symlinks into standard auto-discovery dirs (`~/.claude/skills/`, etc.) work reliably across platforms without requiring marketplace setup | `enabledPlugins` with paths (rejected: silently ignored), `--plugin-dir` flag (rejected: per-session only), local marketplace (rejected: over-engineered for current scope) |
| Homebrew installed by default on Mac | Nearly every Mac dependency (node, gh, rclone, gcloud, go) uses `brew install`. Installing Homebrew first simplifies all downstream steps to one-liners | Ask user to choose (rejected: added friction for non-technical users), direct .pkg downloads (rejected: inconsistent install paths, harder to update) |
| Bootstrap script + setup wizard (two-phase install) | Bootstrap handles prerequisites and cloning (can run via `curl \| bash`). Setup wizard handles interactive decisions (layer selection, personalization, conflict resolution) that require Claude | Single script (rejected: can't do interactive Claude conversation), wizard-only (rejected: can't install prerequisites without Claude running) |
| Root-level `skills/` and `commands/` mirror core | Bootstrap needs to symlink setup-wizard before the full setup runs. Root-level dirs provide a stable reference without depending on layer structure | Symlink directly to `core/` (current approach after fix), hardcoded paths (rejected: fragile) |

## Current Implementation

### 1. Install Flow

```
User runs: curl -fsSL .../install.sh | bash
  │
  ├── Detect OS (macOS / Linux / Windows)
  ├── Install Homebrew (macOS only, if missing)
  ├── Install Node.js (via brew on Mac, apt/dnf on Linux)
  ├── Check for git
  ├── Install Claude Code (npm install -g)
  ├── Clone toolkit → ~/.claude/plugins/claudifest-destiny/
  ├── Symlink /setup command + setup-wizard skill
  ├── Verify symlinks (fallback to copy if broken)
  └── Print "Run: claude → /setup"

User runs: claude → /setup
  │
  ├── Phase 1: Environment inventory
  ├── Phase 2: Conflict resolution (backup + merge/keep/replace)
  ├── Phase 3: Layer selection (core/life/productivity/modules)
  ├── Phase 4: Dependency installation (git, gh, gcloud, rclone, go, todoist)
  ├── Phase 5: Personalization (templates, CLAUDE.md, symlinks, hooks, MCP)
  └── Phase 6: Verification (health checks on all installed components)
```

### 2. Component Registration

Skills, commands, and hooks are registered via symlinks into Claude Code's auto-discovery directories:

| Component type | Source location | Symlink target |
|---------------|----------------|---------------|
| Skills | `{layer}/skills/{name}/` | `~/.claude/skills/{name}` |
| Commands | `core/commands/{name}.md` | `~/.claude/commands/{name}.md` |
| Hooks | `{layer}/hooks/{name}.sh` | `~/.claude/hooks/{name}.sh` |

Hook trigger-point registration is written to `~/.claude/settings.json` under the `hooks` key.

### 3. Layers and Components

| Layer | Skills | Commands | Hooks | MCP Servers |
|-------|--------|----------|-------|-------------|
| Core | setup-wizard | setup, contribute, toolkit-uninstall, update | checklist-reminder, git-sync, session-start, statusline, title-update, todo-capture, write-guard | — |
| Life | encyclopedia-compile, encyclopedia-interviewer, encyclopedia-librarian, encyclopedia-update, google-drive, journaling-assistant | — | sync-encyclopedia | — |
| Productivity | inbox-processor, skill-creator | — | — | todoist, gmessages |
| Elections Notebook | elections-notebook | — | — | — |
| JLBC Fiscal Note | jlbc-fiscal-note | — | — | — |

### 4. Dependencies by Layer

| Dependency | Layer | Required? | Install method (Mac) |
|-----------|-------|-----------|---------------------|
| Homebrew | All (Mac) | Yes | Auto-installed by bootstrap |
| Node.js | All | Yes | `brew install node` |
| git | All | Yes | Xcode CLI tools |
| gh CLI | Core | Strongly recommended | `brew install gh` |
| gcloud CLI | Core | Optional | `brew install --cask google-cloud-sdk` |
| rclone | Life | Yes | `brew install rclone` |
| Go | Productivity | Yes (for gmessages) | `brew install go` |

## Dependencies

- **Depends on:** Claude Code (skill/command/hook auto-discovery, settings.json hook registration), git, Node.js, platform package manager (Homebrew on Mac)
- **Depended on by:** All toolkit skills, hooks, and commands — this spec documents how they get installed

## Known Issues

### MCP servers not accurately matched to desktop environment

The toolkit was developed on a Windows desktop with MCP servers configured locally in `~/.claude.json`. The published toolkit does not yet replicate that setup during installation:

- **Desktop control** — The author's Windows setup uses `windows-control` (uvx/stdio). No Mac/Linux equivalent is bundled. Need to add platform-appropriate desktop control MCP server (e.g., mac-control or cross-platform alternative).
- **gmessages** — Source code is included and the setup wizard builds it via `go build`, but the wizard doesn't write the correct `~/.claude.json` MCP server entry to actually register it. Users must manually add the `mcpServers` config.
- **todoist** — The setup wizard collects the API token but doesn't write the exact config format needed. Should write: `"todoist": { "type": "http", "url": "https://ai.todoist.net/mcp" }`.
- **gmail-extended** — Deprecated and removed from the toolkit. Superseded by Claude.ai's native Gmail MCP connector.

### Other gaps

- Setup wizard's MCP server config step (Phase 5, Step 6) needs concrete config templates for each server rather than vague instructions.
- No automated test for verifying MCP server connectivity after setup.

## Planned Updates

- Write correct `~/.claude.json` entries for todoist and gmessages during setup
- Add platform-appropriate desktop control MCP server
- Add MCP connectivity verification to Phase 6
- Convert root-level `skills/setup-wizard` from copy to proper symlink in git

## Change Log

| Date | Version | What changed | Type |
|------|---------|-------------|------|
| 2026-03-16 | 1.0 | Initial spec — documents install flow, registration mechanism, dependency chain, and known MCP gaps | New |
