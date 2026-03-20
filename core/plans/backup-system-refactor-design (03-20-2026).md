# Backup System Refactor — Design

**Date:** 2026-03-20
**Status:** Approved
**Branch:** `backup-system-refactor`

## Problem Statement

The DestinClaude backup system has three structural problems:

1. **Plugin directory is a blind spot.** `config.json` claims the toolkit is installed (`toolkit_root`, `installed_layers`), but nothing verifies the actual plugin repo exists or is complete. On restore to a new device, the directory is missing or hollow — session-start trusts `config.json` blindly, producing "vunknown" version, missing hooks, and no warning.

2. **Backup scope includes toolkit-owned files.** `git-sync.sh` backs up skills, hooks, specs, and commands that come from the public DestinClaude GitHub repo. These should never be backed up — they should be re-cloned from the repo. Backing them up wastes space, creates version conflicts on restore, and can overwrite freshly installed toolkit files.

3. **Three overlapping backup systems.** `git-sync.sh`, `personal-sync.sh`, and `drive-archive.sh` have overlapping responsibilities, different backend assumptions, and independent debounce logic. The service (Drive, GitHub, iCloud) is hardcoded into each script rather than abstracted.

4. **No structural migration.** Backups mirror the user's local filesystem verbatim. If DestinClaude reorganizes files (renames encyclopedia docs, moves journal paths, restructures folders), restoring an old backup onto a new toolkit version creates mismatches with no migration path.

## Design Decisions

### D1: Single backup engine with pluggable backend drivers

**Decision:** Replace `git-sync.sh`, `personal-sync.sh`, and `drive-archive.sh` with a single `backup-engine.sh` that delegates storage operations to pluggable backend drivers (`backend-drive.sh`, `backend-github.sh`, `backend-icloud.sh`).

**Rationale:** Eliminates overlapping responsibility. Adding a new backend means writing one driver file, not modifying three scripts. All classification, debounce, and logging logic lives in one place.

**Alternatives rejected:**
- Refactor in place (keeps structural overlap, adding backends means touching multiple files)
- Full platform abstraction with formal provider interface (over-engineered for bash scripts)

### D2: Plugin manifest for ownership classification

**Decision:** The toolkit repo contains a `plugin-manifest.json` that lists every file the toolkit owns (skills, hooks, commands, specs, templates). The backup engine consults this manifest to classify files: toolkit-owned files are never backed up, never restored over fresh installs.

**Rationale:** Replaces the current heuristic check (symlink? matches a layer directory?) with an explicit, authoritative list. Works on both symlink and copy-based installs. The manifest is the single source of truth for "does the toolkit own this file?"

**Alternatives rejected:**
- Convention-based (symlinks = toolkit) — breaks on Windows copy-fallback installs

### D3: Primary + secondary backend model

**Decision:** Users choose one primary backend (Drive, GitHub, or iCloud) that handles full backup and restore. An optional secondary backend receives write-only copies of high-value files (memory, CLAUDE.md, custom skills) as a disaster recovery mirror. Restore always pulls from the primary.

**Rationale:** Keeps it simple for users (one choice) while preserving a safety net. The secondary doesn't need pull, conflict, or migration logic.

**Alternatives rejected:**
- One backend per data category (too complex for users to configure)
- One backend for everything with no secondary (loses DR safety net)
- Fully independent primary/secondary (secondary needs unnecessary pull/conflict logic)

### D4: Toolkit integrity check with auto-recovery

**Decision:** `session-start.sh` verifies toolkit integrity on every session (directory exists, VERSION file exists, plugin.json exists, .git exists, layer directories exist). If any check fails, it auto-clones the toolkit from GitHub, reinstalls symlinks/hooks, and tells the user what happened.

**Rationale:** Directly fixes the blind spot from the problem statement. Beginners shouldn't have to diagnose missing repos. Auto-recovery is safe because it only touches toolkit-owned files (per the manifest), never personal data.

**Fallback:** If git clone fails (offline, no git), show a warning and suggest `/setup-wizard` when back online. Session continues in degraded mode.

### D5: Installer-first restore ordering

**Decision:** On a returning-user setup, the wizard runs the full install first (clone repo, register hooks/skills, generate config, generate CLAUDE.md), THEN restores personal data on top. Backup files never overwrite anything the installer just wrote.

**Rationale:** Eliminates the current conflict where backup files arrive before the toolkit is installed and then get overwritten (or worse, prevent proper installation). The toolkit is always in a known-good state before personal data is layered on.

### D6: CLAUDE.md merge with user choice

**Decision:** During restore, the user is shown three options in plain language:
1. **Merge** (recommended) — keep personal notes/preferences, update toolkit sections to match current install
2. **Use backup** — restore exactly as-is
3. **Start fresh** — keep only the wizard-generated version

**Rationale:** CLAUDE.md is a hybrid (toolkit fragments + user customizations). Neither "backup wins" nor "installer wins" is universally correct. The marker system already enables clean fragment identification. Non-technical users need simple, plain-language options.

### D7: Ask before backing up user-created extensions

**Decision:** When the backup engine encounters a skill, hook, or other file that isn't in the plugin manifest and isn't in the standard personal data list, it asks the user whether to back it up. The answer is stored in `config.json` under `user_extensions` so it only asks once per extension.

**Rationale:** Users may have experimental skills they don't care about, or custom skills that are critical. The system shouldn't assume either way. Asking once and remembering is the right balance between safety and friction.

### D8: Canonical backup schema with versioned migrations

**Decision:** The backup engine writes data to the backend in a versioned canonical structure (defined by `backup-schema.json`), independent of local filesystem layout. On restore, if the backup's schema version is older than the current toolkit expects, migration scripts (`core/migrations/v1-to-v2.sh`, etc.) transform the backup forward before restoring.

**Rationale:** DestinClaude's file organization evolves over time (encyclopedia docs get added/removed/renamed, journal paths change, folder structure shifts). Without a canonical schema, old backups silently produce mismatched file structures on new installs. Migrations allow the backup to be restructured before restore, producing a clean result regardless of when the backup was made.

### D9: External projects via explicit registry

**Decision:** External projects (like `~/destincode/`) are tracked in a `backup_registry` array in `config.json`. Each entry has path, remote, and branch. The existing `.unsynced-projects` detection and statusline warnings remain unchanged — they surface projects not in the registry.

**Rationale:** Keeps the existing discovery-and-warn pattern that the statusline already implements. Formalizes the registration without changing the user-facing warnings.

## Architecture

### Component Map

```
~/.claude/plugins/destinclaude/
├── plugin-manifest.json              # NEW — declares all toolkit-owned files
├── backup-schema.json                # NEW — current schema version + category-to-path map
├── core/
│   ├── hooks/
│   │   ├── backup-engine.sh          # NEW — replaces git-sync, personal-sync, drive-archive
│   │   ├── backends/
│   │   │   ├── backend-drive.sh      # NEW — push/pull/check for Google Drive
│   │   │   ├── backend-github.sh     # NEW — push/pull/check for private GitHub
│   │   │   └── backend-icloud.sh     # NEW — push/pull/check for iCloud
│   │   ├── session-start.sh          # MODIFIED — add toolkit integrity check + auto-recovery
│   │   ├── statusline.sh             # UNCHANGED
│   │   └── write-guard.sh            # UNCHANGED
│   ├── migrations/                    # NEW — schema version migration scripts
│   │   └── v1-to-v2.sh
│   ├── commands/
│   │   └── restore.md                # NEW — ad-hoc /restore command
│   └── skills/
│       └── setup-wizard/
│           └── SKILL.md              # MODIFIED — Phase 5R restore flow
```

### Files Deleted

| File | Replacement |
|------|------------|
| `core/hooks/git-sync.sh` | `backup-engine.sh` |
| `core/hooks/personal-sync.sh` | `backup-engine.sh` |
| `core/hooks/drive-archive.sh` (or `~/.claude/hooks/`) | `backends/backend-drive.sh` |

### Data Flow

**Push (PostToolUse on Write/Edit):**
1. Parse stdin JSON, extract `file_path`
2. Classify file against manifest → exclusion list → personal data list → user extension list
3. If not backupable, exit
4. Map local path to canonical backup path
5. Push to primary backend (debounced 15 min)
6. If secondary configured AND file is high-value (memory, CLAUDE.md, custom skills): push to secondary (best-effort, non-blocking)

**Pull (session-start):**
1. Pull from primary backend only
2. Read `backup-schema.json` from backend
3. Run migrations if schema version < current
4. For each pulled file, classify before writing locally
5. Never overwrite toolkit-owned files (manifest check)
6. Write personal data to correct local paths via path map

**Restore (setup wizard Phase 5R or `/restore`):**
1. Connect to backup backend, verify reachable
2. Read `backup-schema.json`, run migrations if needed
3. Restore memory files → direct write
4. Restore conversation history → direct write
5. Restore keybindings → direct write
6. CLAUDE.md → three-option merge prompt
7. Encyclopedia → migrate to current doc types
8. Journal entries → migrate to current format
9. Custom skills → ask per skill
10. External projects → offer to re-register from backup registry
11. Verify toolkit files still intact (manifest check)

**Toolkit integrity (session-start, every session):**
1. Check: toolkit_root exists? VERSION exists? plugin.json exists? .git exists? Layer dirs exist?
2. All pass → continue normally
3. Any fail → auto-clone from GitHub, reinstall symlinks/hooks, notify user
4. Clone fails → log error, show warning, suggest `/setup-wizard`, continue degraded

### Data Classification

| Category | Examples | Backed up? | Restore behavior |
|----------|----------|-----------|-----------------|
| Toolkit-owned | Skills, hooks, commands, specs in manifest | Never | Re-cloned from GitHub |
| Personal data | Memory, CLAUDE.md, keybindings, conversations | Always | Direct restore (CLAUDE.md gets merge prompt) |
| User-created extensions | Custom skills/hooks not in manifest | Ask user, remember | Restore after toolkit install, ask per item |
| Generated config | settings.json, config.json, .claude.json | Never | Regenerated by installer/wizard |
| External projects | ~/destincode/, etc. | Per registry | Independent git repos |
| Ephemeral | Sessions, tasks, shell-snapshots, locks | Never | Regenerated at runtime |
| Secrets | Credentials, tokens, .env | Never | User re-authenticates |

### Backup Scope (Primary vs Secondary)

| Data | Primary | Secondary (write-only mirror) |
|------|---------|-------------------------------|
| Memory files | Yes | Yes |
| CLAUDE.md | Yes | Yes |
| Custom skills | Yes | Yes |
| Keybindings | Yes | No |
| Conversation history | Yes | No |
| Encyclopedia | Yes | No |
| Journal entries | Yes | No |
| External projects | Yes (via registry) | No |

### Canonical Backup Structure

```
{backup_root}/
├── backup-schema.json
├── memory/
│   ├── {project-key}/
│   │   ├── MEMORY.md
│   │   └── *.md
│   └── ...
├── claude-md/
│   └── CLAUDE.md
├── config/
│   └── keybindings.json
├── conversations/
│   └── {project-key}/*.jsonl
├── encyclopedia/
│   ├── Core Identity.md
│   ├── Status Snapshot.md
│   └── ...
├── journal/
│   └── entries/*.md
└── extensions/
    ├── skills/{name}/
    └── hooks/
```

### Backend Driver Interface

Each driver in `core/hooks/backends/` implements:

```bash
backup_push <local_path> <remote_path>    # Upload file/directory
backup_pull <remote_path> <local_path>    # Download file/directory
backup_check                               # Return 0 if backend is reachable/configured
```

| Driver | Push mechanism | Pull mechanism |
|--------|---------------|----------------|
| `backend-drive.sh` | `rclone copyto --checksum` | `rclone sync --update` |
| `backend-github.sh` | `git add/commit/push` | `git pull` |
| `backend-icloud.sh` | `cp` to iCloud path | `cp` from iCloud path |

### Config Model

```json
{
  "toolkit_root": "~/.claude/plugins/destinclaude",
  "installed_layers": ["core", "life", "productivity"],
  "platform": "windows",
  "comfort_level": "beginner",
  "DRIVE_ROOT": "Claude",
  "primary_backend": "drive",
  "secondary_backend": "github",
  "secondary_backend_repo": "https://github.com/user/claude-backup.git",
  "backup_registry": [
    { "path": "~/destincode", "remote": "https://github.com/user/destincode.git", "branch": "master" }
  ],
  "user_extensions": {
    "skills": ["my-custom-skill"],
    "hooks": []
  }
}
```

### Setup Wizard Restore Flow (Revised)

```
Phase 0: "Have you used DestinClaude before?"
  → No  → Normal install (Phases 1-6)
  → Yes → Continue to Phase 1

Phase 1: Environment inventory (unchanged)
Phase 2: Conflict resolution (unchanged)
Phase 3: Layer selection (unchanged)
Phase 4: Dependency installation (unchanged)
Phase 5: Personalization — FULL RUN
         Clone toolkit, register hooks/skills/commands
         Generate settings.json, config.json, CLAUDE.md
         System is now in a clean, fully installed state

Phase 5R: Restore personal data (NEW)
  1. Ask which backend the backup lives on (Drive / GitHub / iCloud)
  2. Connect to backend, verify reachable
  3. Read backup-schema.json, run migrations if needed
  4. List what's available in the backup
  5. Restore memory → direct write
  6. Restore conversation history → direct write
  7. Restore keybindings → direct write
  8. CLAUDE.md merge prompt:
     "I found your previous personal instructions from your backup.
      I also just generated fresh instructions based on your current
      toolkit setup. Would you like me to:
      1. Merge them — Keep your personal notes and preferences, but
         update the toolkit sections to match what's installed now
         (recommended)
      2. Use your backup — Restore exactly what you had before, as-is
      3. Start fresh — Keep only the new version the setup wizard
         just created"
  9. Encyclopedia → migrate to current doc types
  10. Custom skills — ask per skill:
      "I found a custom skill called '{name}' in your backup.
       This isn't part of the DestinClaude toolkit. Restore it?"
  11. External projects → offer to re-register
  12. Verify toolkit files still intact (manifest check)

Phase 6: Verification (unchanged, plus verify restore succeeded)
```

### State Files

| File | Purpose | Changed? |
|------|---------|----------|
| `~/.claude/.push-marker-{project}` | Per-project debounce timer | Unchanged |
| `~/.claude/.sync-status` | Human-readable status for statusline | Unchanged |
| `~/.claude/.sync-warnings` | Warning flags for statusline | Unchanged |
| `~/.claude/.backup-lock/` | Mutex directory | Unchanged |
| `~/.claude/backup.log` | Persistent log | Unchanged |
| `~/.claude/.unsynced-projects` | Unregistered project detection | Unchanged |
| `~/.claude/.write-registry.json` | Concurrent write guard | Unchanged |

### Invariants

1. **Toolkit files are never backed up** — manifest check prevents it
2. **Backup never overwrites toolkit files** — manifest check on restore
3. **Installer always wins** — wizard installs fresh, then restore layers personal data on top
4. **Broken toolkit auto-recovers** — session-start clones from GitHub if integrity check fails
5. **Backups are structure-independent** — canonical schema with versioned migrations
6. **Statusline stays unchanged** — same warning language, same files, same display logic
7. **Failures are always visible** — logged to backup.log AND surfaced in session
8. **User-created extensions require consent** — asked once per extension, answer remembered
