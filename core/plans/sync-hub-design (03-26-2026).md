---
title: "/sync Skill Enhancement — Unified Interactive Hub"
version: 1.0
status: approved
date: 2026-03-26
affects:
  - skills/sync/SKILL.md
  - core/hooks/session-start.sh
  - core/hooks/personal-sync.sh
  - core/hooks/contribution-detector.sh
  - skill-creator skill (external, at ~/.claude/skills/skill-creator/)
  - ~/.claude/toolkit-state/skill-routes.json (new)
---

# /sync Skill Enhancement — Unified Interactive Hub

## Goal

Evolve `/sync` from a status-and-warnings tool into a full sync management hub
with backend reconfiguration, per-skill backup routing, and round-trip backend
testing — all through a single conversational entry point.

## Core UX

`/sync` always shows the status dashboard first, then presents a contextual
action menu. No subcommands to memorize. The skill asks what you want to do and
routes accordingly.

### Flow

1. Always show the status dashboard (existing §1–§2)
2. Below the dashboard, present an action menu based on context:
   - If warnings exist → "Resolve warnings" (existing §3)
   - If unrouted skills detected → "Configure skill backups"
   - If unsynced projects detected → "Register projects" (existing §4)
   - Always available → "Reconfigure backends", "Manage skill backups", "Force sync now"
3. Ask "What would you like to do?" — user picks, skill routes to the right section
4. After completing an action, return to the dashboard (refreshed) and ask again,
   until user is done

The dashboard becomes a hub, not a one-shot report.

---

## New Capabilities

### §7 — Backend Reconfiguration

Full interactive reconfiguration of sync backends within `/sync` itself.
Users should not need to re-run the setup wizard to swap a backend.

#### Flow

1. Show current backend config:
   ```
   Backend    Status           Config
   Drive      active           gdrive:Claude/Backup/personal/
   GitHub     active           git@github.com:user/claude-backup.git
   iCloud     not configured
   ```

2. Ask what they want to do:
   - Add a new backend
   - Remove an existing backend
   - Change settings for an existing backend (repo URL, Drive root, iCloud path)
   - Test all backends

#### Adding a backend

- Pick which (Drive / GitHub / iCloud)
- Walk through setup (rclone remote exists? GitHub repo exists? iCloud path valid?)
- Run full round-trip test (write temp file → read back → verify content → delete)
- On success → update `config.json` `PERSONAL_SYNC_BACKEND` list, confirm
- On failure → show actionable error, offer to retry or skip

#### Removing a backend

- Confirm removal ("your data on this backend won't be deleted, just no longer synced to")
- Update `config.json`, confirm

#### Testing backends

- Round-trip test on each configured backend
- Report per-backend: write ✓/✗, read ✓/✗, delete ✓/✗, latency
- Actionable errors for failures (e.g., "rclone auth expired — run `rclone config reconnect gdrive:`")

---

### §8 — Skill Backup Management

Per-skill routing to one of three destinations, with proactive detection and
contribution PR tracking.

#### Routing options (per skill)

1. **Personal sync** — back up to configured backends
2. **No backup** — skip this skill (lives only in the toolkit install)
3. **Contribute to DestinClaude** — fork/branch/PR immediately via existing
   `/contribute` machinery, keep personal-syncing as safety net until PR merged

#### Flow

1. Show current skill routing table:
   ```
   Skill              Backup Route         Status
   journaling         personal-sync        ✓ synced
   elections-notebook  personal-sync        ✓ synced
   announce           contribute           PR #72 open
   my-new-skill       ⚠ unrouted           —
   ```

2. If unrouted skills exist, handle those first — for each, ask which route
3. For already-routed skills, user can select any skill to change its routing

#### Contribute flow

- Delegates to existing `/contribute` machinery (fork detection, private-manifest
  filtering, branch, PR)
- Records in routing manifest with PR number
- Skill stays in personal-sync until PR status is "merged"
- Dashboard shows PR status (open / merged / closed) pulled from `gh pr view`

#### Routing manifest — `skill-routes.json`

New file: `~/.claude/toolkit-state/skill-routes.json`

```json
{
  "journaling": { "route": "personal", "since": "2026-03-20" },
  "announce": { "route": "contribute", "pr": 72, "since": "2026-03-25" },
  "my-tool": { "route": "none", "since": "2026-03-25" }
}
```

This is the **single source of truth** for skill backup routing. Replaces
skill-level entries in `contribution-tracker.json`.

#### Proactive detection

`session-start.sh` scans `~/.claude/skills/` for directories not present in
`skill-routes.json`, adds them to `.sync-warnings` as `SKILLS:unrouted:name`.
This replaces the existing `SKILLS:name` warning format (which flagged skills
not backed up to any personal-sync backend). The new format is a superset —
unrouted skills are by definition not backed up.

#### Skill-creator integration

At the end of skill creation, the skill-creator skill asks "Where should this
skill be backed up?" with the same three options and writes the choice to
`skill-routes.json`.

---

## Changes to Existing Systems

### `session-start.sh`

Add unrouted skill detection alongside existing unsynced project detection.
Scan `~/.claude/skills/` dirs against `skill-routes.json`, emit
`SKILLS:unrouted:name` warnings.

### `personal-sync.sh`

Before syncing a skill directory, check `skill-routes.json`:
- `"none"` → skip
- `"contribute"` → still personal-sync (safety net until PR merged)
- `"personal"` → sync as today
- Not in manifest → sync as today (backwards compatible)

### `contribution-detector.sh`

Read `skill-routes.json` for skills. Skip suggesting skills already routed as
`"contribute"` or `"none"`. Only suggest skills routed as `"personal"` or
unrouted.

### `skill-creator` skill

Add a final step after skill creation: "Where should this skill be backed up?"
→ write choice to `skill-routes.json`.

### `/sync` SKILL.md

- §2 (dashboard) gains skill routing summary row
- §3 (warning resolution) gains `SKILLS:unrouted` warning type
- §7 (new) — Backend Reconfiguration
- §8 (new) — Skill Backup Management
- §4–§6 unchanged

### `contribution-tracker.json`

Skill-level entries migrate to `skill-routes.json`. The contribution tracker
continues to track non-skill file contributions (hook improvements, etc.).

---

## New State Files

| File | Purpose | Written by | Read by |
|------|---------|-----------|---------|
| `~/.claude/toolkit-state/skill-routes.json` | Per-skill backup routing manifest | `/sync` skill, skill-creator | personal-sync.sh, contribution-detector.sh, session-start.sh, `/sync` skill |

---

## What's NOT Changing

- No new hooks or scripts
- No new commands or skills
- §4 (project onboarding), §5 (force sync), §6 (path normalization) unchanged
- Git-sync.sh unchanged
- Backup-common.sh unchanged
- Restore workflow unchanged

---

## Design Decisions

### D1: Conversational routing over subcommands

The skill asks what the user wants rather than requiring `/sync config` or
`/sync skills` syntax. Reduces cognitive load — one command, one flow.

**Why:** Users think of "sync" as one thing. Subcommand syntax fragments the
mental model and requires memorizing argument patterns.

### D2: skill-routes.json as single source of truth

Rather than splitting skill routing between `contribution-tracker.json` and a
new manifest, consolidate into one file.

**Why:** `contribution-tracker.json` tracks individual file contributions
(hook improvements, etc.) which is a different concern. Skills are atomic
units that should be routed whole.

### D3: Contributed skills keep personal-syncing until PR merged

Safety net — if the PR is closed or abandoned, the user's copy is still backed
up.

**Why:** Contributing is not the same as backing up. A rejected PR shouldn't
mean the skill vanishes from backups.

### D4: Full round-trip backend testing

Write → read → verify → delete, not just connectivity check.

**Why:** "Can I reach Drive?" doesn't catch permission issues, quota limits,
or rclone config problems. A round-trip test proves the pipeline works
end-to-end.

### D5: Hub-and-return dashboard pattern

After each action completes, return to a refreshed dashboard and offer the
menu again.

**Why:** Users often need to do multiple things (configure a backend, then
route a skill, then force sync). Returning to the hub avoids re-invoking
`/sync` repeatedly.
