# Sync Consolidation — Design

**Date:** 2026-04-01
**Status:** Approved
**Supersedes:** backup-system-refactor-design (03-22-2026) D1 (separate scripts decision)

## Problem Statement

The backup system has two PostToolUse hooks — `git-sync.sh` and `personal-sync.sh` — that back up largely the same files through different mechanisms. This creates confusion (even for the system's author), overlapping scope, and a split where some config files (settings, keybindings, plans, specs) are only backed up if the user also maintains a separate git repo at `~/.claude/`.

The two-script architecture was an intentional design decision (D1 in backup-system-refactor-design, 03-22-2026) with the rationale that "git-sync is about version control, personal-sync is about data replication." In practice, both systems evolved to cover the same data, and personal-sync's GitHub backend already performs git operations — making the distinction artificial.

## Solution

Consolidate into a single unified script (`sync.sh`) based on `personal-sync.sh`'s existing multi-backend architecture. Expand its file scope to cover everything git-sync currently handles. Drop the local `~/.claude/` git repo requirement entirely.

## Design Decisions

### D1: Single script replaces two

**Decision:** Create `core/hooks/sync.sh` by expanding `personal-sync.sh`'s path filter and remote layout. Delete both `git-sync.sh` and `personal-sync.sh`.

**Rationale:** personal-sync already has battle-tested multi-backend support (Drive, GitHub, iCloud), mutex locking, debounce, conversation snapshotting, and cross-platform handling. The change is additive — widen the file scope, reorganize remote paths — not a rewrite.

**Alternatives rejected:**
- New script from scratch (rejected: rewrites working code, introduces bugs)
- Thin wrapper delegating to personal-sync (rejected: two files doing one job)

### D2: No local git repo

**Decision:** The unified system does not maintain a git repository at `~/.claude/`. No `git add`, `git commit`, `git push`, or `git pull --rebase`. The `GIT_REMOTE` config key is retired.

**Rationale:** The local git repo's value was per-file commit history and rollback. With cloud backends providing their own version history (Drive file versions, GitHub commit history via personal-sync's GitHub backend, iCloud versions), the local repo adds complexity without unique value. Dropping it eliminates the `GIT:NOT_INITIALIZED` warning, rebase conflict handling, stash management, and the confusing two-repo setup (claude-config.git vs personal-sync-repo).

### D3: Expanded file scope with `system-backup/` grouping

**Decision:** The unified script backs up everything personal-sync currently covers, plus all files git-sync covered that personal-sync didn't. New files are grouped under a `system-backup/` folder on the remote to avoid cluttering the user's cloud storage with unfamiliar config files.

**File scope:**

| Content | Local path | Remote path |
|---------|-----------|-------------|
| Memory files | `*/projects/*/memory/*` | `memory/{project-key}/` |
| CLAUDE.md | `*/CLAUDE.md` | `CLAUDE.md` |
| Conversations | `*/projects/*/*.jsonl` | `conversations/{slug}/` |
| Encyclopedia cache | `*/encyclopedia/*` | `encyclopedia/` |
| User-created skills | `*/skills/*` (non-symlinks) | `skills/{name}/` |
| Toolkit config | `*/toolkit-state/config.json` | `system-backup/config.json` |
| Settings | `*/settings.json` | `system-backup/settings.json` |
| Keybindings | `*/keybindings.json` | `system-backup/keybindings.json` |
| MCP config | `*/mcp.json` | `system-backup/mcp.json` |
| History | `*/history.jsonl` | `system-backup/history.jsonl` |
| Plans | `*/plans/*` | `system-backup/plans/` |
| Specs | `*/specs/*` | `system-backup/specs/` |

**Still excluded:**
- `config.local.json` — machine-specific, rebuilt each session
- `mcp-config.json` — machine-specific paths
- `settings.local.json` — machine-specific overrides
- Credentials, tokens, secrets
- Toolkit-owned symlinks
- `node_modules/`, `__pycache__/`

**Rationale:** Non-technical users opening their Drive see meaningful folders (memory, conversations, skills) at the top level. System config is tucked into `system-backup/` — discoverable but not cluttering.

### D4: `GIT_REMOTE` auto-migration

**Decision:** On update, if `GIT_REMOTE` is set and not `"none"`:
1. Add `github` to `PERSONAL_SYNC_BACKEND` if not already present
2. Set `PERSONAL_SYNC_REPO` to the `GIT_REMOTE` value if `PERSONAL_SYNC_REPO` is empty
3. Remove `GIT_REMOTE` from config

**Rationale:** Users who configured `GIT_REMOTE` wanted GitHub backup. Auto-migrating preserves their intent without requiring manual reconfiguration. Using the existing `PERSONAL_SYNC_BACKEND`/`PERSONAL_SYNC_REPO` keys means no new config surface.

### D5: Write registry moves into sync.sh

**Decision:** The write registry update (recording PID + content hash to `.write-registry.json`) moves from `git-sync.sh` into `sync.sh`. The write-guard PreToolUse hook continues reading the registry unchanged.

**Rationale:** The registry must be updated by a PostToolUse hook (needs the file's post-write hash). `sync.sh` is the only remaining PostToolUse hook on Write/Edit that touches `~/.claude/` files. write-guard.sh is PreToolUse and can't record post-write state.

### D6: Remote storage migration

**Decision:** One-time `rclone copy` from `personal/toolkit-state/config.json` to `personal/system-backup/config.json` on Drive. Gated by marker file `~/.claude/toolkit-state/.sync-consolidation-migrated`. Uses `copy` (not `move`) so unmigrated devices still read old paths.

**Rationale:** Consistent with prior migration patterns (legacy conversation migration used the same marker-gated copy approach).

### D7: Clean swap on update

**Decision:** The migration runs in `post-update.sh`. Old symlinks are removed, new symlink created, config migrated, state files cleaned up — all in one update cycle. No transition period with both systems running.

**Rationale:** Matches precedent (v4.0 refactor was a clean swap). Transition periods add maintenance burden for a change that's straightforward to migrate.

### D8: Don't delete user's git repo

**Decision:** If `~/.claude/.git/` exists, the migration does NOT remove it. Log a note suggesting the user can remove it manually.

**Rationale:** The git repo may contain history the user values. Deleting it is destructive and irreversible. Let the user decide.

## Remote Storage Layout

All three backends (Drive, GitHub, iCloud) mirror this structure:

```
{root}/
├── CLAUDE.md
├── memory/
│   └── {project-key}/
├── conversations/
│   └── {slug}/
├── encyclopedia/
├── skills/
│   └── {skill-name}/
└── system-backup/
    ├── config.json
    ├── settings.json
    ├── keybindings.json
    ├── mcp.json
    ├── history.jsonl
    ├── plans/
    └── specs/
```

## Session-Start Changes

**Removed:**
- `GIT:NOT_INITIALIZED` warning check
- Conditional git pull on `~/.claude/` (was gated on `GIT_REMOTE`)
- `git-sync.sh` and `personal-sync.sh` from hook integrity check list

**Changed:**
- Hook integrity list: replaced with `sync.sh`
- `.personal-sync-marker` renamed to `.sync-marker`
- Force-sync path calls `sync.sh` instead of `personal-sync.sh`

**Kept as-is:**
- Personal data pull from preferred backend
- Conversation pull + `aggregate_conversations()`
- Staleness check (using renamed marker)
- Unbackedup skills detection
- Project discovery

## Migration Steps (post-update.sh)

1. **Config migration:**
   - Read `GIT_REMOTE` from config
   - If set and not `"none"`: add `github` to `PERSONAL_SYNC_BACKEND`, set `PERSONAL_SYNC_REPO` if empty
   - Remove `GIT_REMOTE` key
   - Remove `GIT_REMOTE` from template-variables.json defaults

2. **Hook migration:**
   - Remove `~/.claude/hooks/git-sync.sh` symlink
   - Remove `~/.claude/hooks/personal-sync.sh` symlink
   - Create `~/.claude/hooks/sync.sh` symlink → toolkit `core/hooks/sync.sh`
   - Update settings.json hook entries

3. **State file cleanup:**
   - Remove `.push-marker`
   - Remove `.rebase-fail-count`
   - Remove `.sync-status`
   - Rename `.personal-sync-marker` → `.sync-marker`

4. **Remote storage migration (first sync after update):**
   - Copy `toolkit-state/config.json` → `system-backup/config.json` on remote
   - Gate with `.sync-consolidation-migrated` marker

5. **Git repo advisory:**
   - If `~/.claude/.git/` exists, log: "Your ~/.claude git repo is no longer used by the sync system. You can remove it with `rm -rf ~/.claude/.git` if you no longer need local version history."

## Affected Files

**Created:**
- `core/hooks/sync.sh`

**Deleted:**
- `core/hooks/git-sync.sh`
- `core/hooks/personal-sync.sh`

**Code changes:**
- `core/hooks/session-start.sh` — remove git pull, `GIT:NOT_INITIALIZED`, update hook list, rename marker
- `core/hooks/session-end-sync.sh` — update comments
- `core/hooks/write-guard.sh` — update comment reference
- `core/hooks/hooks-manifest.json` — two entries → one
- `core/hooks/checklist-reminder.sh` — update comment
- `core/hooks/lib/backup-common.sh` — update header comment
- `scripts/post-update.sh` — migration logic + hook verification
- `core/skills/setup-wizard/SKILL.md` — remove `GIT_REMOTE` question
- `core/skills/sync/SKILL.md` — update force-sync, remove git references
- `core/templates/template-variables.json` — remove `GIT_REMOTE`

**Spec/doc updates:**
- `core/specs/backup-system-spec.md` — major rewrite for single-system architecture
- `core/specs/personal-sync-spec.md` — retire or merge into backup-system-spec
- `core/specs/write-guard-spec.md` — update references
- `core/specs/statusline-spec.md` — remove git-sync status references
- `core/specs/system-architecture-spec.md` — update sync section
- `core/specs/destinclaude-spec.md` — update references
- `core/specs/memory-system-spec.md` — update sync references
- `core/specs/specs-system-spec.md` — update references
- `core/specs/INDEX.md` — update spec list
- `RESTORE.md` — update restore instructions
- `CHANGELOG.md` — add entry
- `core/commands/diagnose.md` — update references
- `core/commands/health.md` — update references
- `core/commands/toolkit.md` — update feature list
- `docs/system-architecture.md` — update sync description

**No changes (historical):**
- Plans and old design docs remain as point-in-time records

## Dependencies

- **Depends on:** `rclone` (Drive), `git` + `gh` (GitHub backend), iCloud app (iCloud backend), `lib/backup-common.sh`
- **Depended on by:** session-start.sh (pull), session-end-sync.sh (session exit sync), write-guard.sh (registry), `/sync` skill, setup wizard, statusline
