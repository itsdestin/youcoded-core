# Sync Hub SKILL.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `/sync` SKILL.md to implement the full sync hub UX — hub-and-return action menu, backend reconfiguration (§7), skill backup management (§8), and fix stale post-consolidation references.

**Architecture:** Pure SKILL.md rewrite (prompt engineering, no shell scripts). The hook plumbing (`sync.sh`, `session-start.sh`, `contribution-detector.sh`) already supports `skill-routes.json`. This plan adds the user-facing skill instructions that write that file and manage backends interactively. The SKILL.md is a Claude instruction file — each § is a section Claude follows when the `/sync` skill is invoked.

**Tech Stack:** Markdown (SKILL.md prompt), bash commands (inline in the skill), node one-liners for JSON manipulation.

**Design doc:** `core/plans/sync-hub-design (03-26-2026).md` v1.1

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `core/skills/sync/SKILL.md` | Rewrite | Add §7, §8, hub UX, fix stale refs |

Single file change. All work is in SKILL.md.

---

### Task 1: Remove stale git-sync references from §1 and §2

The consolidation (PR #103) removed `git-sync.sh` and the local `~/.claude/.git` repo. The SKILL.md still references both.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Read current SKILL.md and identify stale references**

Open `core/skills/sync/SKILL.md`. Find and note:
1. §1 reads `~/.claude/.sync-status` — this file was written by `git-sync.sh` which no longer exists
2. §1 runs `git -C ~/.claude remote get-url origin` — no local git repo anymore
3. §2 has a "System (Git)" section showing `~/.claude → origin` status
4. §2 Skills section says "git-tracked" which referenced the local git repo

- [ ] **Step 2: Update §1 — remove git-sync state files, add skill-routes read**

In §1 "Read State Files", make these changes:

Remove:
```bash
cat ~/.claude/.sync-status 2>/dev/null           # Git sync status line
```

Remove:
```bash
# Git-sync remote status
git -C ~/.claude remote get-url origin 2>/dev/null
```

Remove the `.push-marker` read (was git-sync debounce):
```bash
cat ~/.claude/.push-marker 2>/dev/null           # Git-sync push debounce timestamp
```

Add (after the config.json read):
```bash
cat ~/.claude/toolkit-state/skill-routes.json 2>/dev/null  # Skill backup routing manifest
```

- [ ] **Step 3: Update §2 — replace dashboard layout**

Replace the entire §2 dashboard template with:

```
═══════════════════════════════════════════════════
  Sync Status
═══════════════════════════════════════════════════

  Backends:
    Drive: ✓ active → gdrive:{DRIVE_ROOT}/Backup/personal/
    GitHub: ✓ active → {SYNC_REPO}
    iCloud: ✓ active → {ICLOUD_PATH}
    — OR —
    ⚠ No backends configured — run /setup-wizard

  Last Sync:
    Xm ago (via sync.sh debounce)
    — OR —
    ⚠ Stale (last sync: Xd ago)
    — OR —
    Never synced

  Skills:
    N synced (personal), M contributed, K skipped
    — OR —
    ⚠ N unrouted: name1, name2

  Projects:
    N tracked, M unsynced detected
    — OR —
    ✓ All projects tracked (N total)

═══════════════════════════════════════════════════
```

The "Backends" row replaces the old "System (Git)" + "Personal Data" split. Read `PERSONAL_SYNC_BACKEND` from config.json to determine which backends are active. Use `get_backends` style logic — the value is a comma-separated string like `"drive"`, `"drive,github"`, or `"drive,icloud"`.

The "Skills" row now shows routing summary from `skill-routes.json`: count skills by route type (`personal`, `contribute`, `none`) and flag any skills in `~/.claude/skills/` not present in the manifest as "unrouted".

- [ ] **Step 4: Commit**

```bash
git add core/skills/sync/SKILL.md
git commit -m "fix(sync): remove stale git-sync references from SKILL.md §1-§2"
```

---

### Task 2: Fix §3 warning handlers for post-consolidation format

§3 has handlers for warning types emitted by `session-start.sh`. Two need updating.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Update PERSONAL:STALE handler**

In §3, find the `PERSONAL:STALE` handler. It currently says:
> Check if `personal-sync.sh` is registered as a PostToolUse hook

Change to:
> Check if `sync.sh` is registered as a PostToolUse hook in `~/.claude/settings.json`

Also update the debounce marker path reference from `.personal-sync-marker` to `.sync-marker` (already correct in §1 but verify consistency).

- [ ] **Step 2: Replace SKILLS:name1,name2 handler with SKILLS:unrouted handler**

Replace the entire `### SKILLS:name1,name2` section. The old handler offered "Add to git tracking" which no longer applies (no local git repo). The new format is `SKILLS:unrouted:name1,name2`.

New handler:

```markdown
### SKILLS:unrouted:name1,name2
For each unrouted skill:
> `<name>` exists at `~/.claude/skills/<name>/` but has no backup route configured.
>
> Options:
> 1. **Personal sync** — back up to your configured backends (recommended)
> 2. **Contribute to DestinClaude** — open a PR to share this skill upstream (also stays in personal sync as safety net)
> 3. **No backup** — skip this skill (lives only on this machine)

Write the user's choice to `~/.claude/toolkit-state/skill-routes.json`:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const name = process.argv[2];
  const route = process.argv[3];
  let routes = {};
  try { routes = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  routes[name] = { route: route, since: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(f, JSON.stringify(routes, null, 2) + '\n');
" ~/.claude/toolkit-state/skill-routes.json "<name>" "<personal|contribute|none>"
```

If the user picks "Contribute", also run `/contribute` to create the PR. Record the PR number:
```bash
# After /contribute creates the PR, update skill-routes.json with the PR number:
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const name = process.argv[2];
  const pr = parseInt(process.argv[3]);
  let routes = {};
  try { routes = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  routes[name] = { route: 'contribute', pr: pr, since: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(f, JSON.stringify(routes, null, 2) + '\n');
" ~/.claude/toolkit-state/skill-routes.json "<name>" "<pr-number>"
```
```

- [ ] **Step 3: Commit**

```bash
git add core/skills/sync/SKILL.md
git commit -m "fix(sync): update §3 warning handlers for post-consolidation formats"
```

---

### Task 3: Add hub-and-return UX (action menu + loop)

This is the core UX change (design decision D5). After showing the dashboard, present an action menu and loop back after each action.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Add action menu section between §2 and §3**

After the §2 dashboard, add a new section. Insert it right after the "If there are no warnings..." paragraph and before §3:

```markdown
## Action Menu

After showing the dashboard, present a contextual action menu. Include all items — mark contextual items only when they apply:

```
What would you like to do?

  1. Resolve warnings          (if warnings exist)
  2. Configure skill backups   (if unrouted skills detected, or anytime)
  3. Register projects         (if unsynced projects detected)
  4. Reconfigure backends
  5. Force sync now
  6. Done
```

Only show options 1–3 when their condition is true. Options 4–6 are always available.

Wait for the user to pick. Route to the corresponding section:
- 1 → §3 (Warning Resolution)
- 2 → §8 (Skill Backup Management)
- 3 → §4 (Project Onboarding)
- 4 → §7 (Backend Reconfiguration)
- 5 → §5 (Force Sync)
- 6 → End. Say "All good — your data is protected." and stop.

### Hub Return

After completing ANY section (§3, §4, §5, §7, §8), return here:
1. Re-read the state files from §1 (they may have changed)
2. Show a refreshed dashboard (§2)
3. Show the action menu again
4. Continue until the user picks "Done"

This makes `/sync` a hub, not a one-shot report.
```

- [ ] **Step 2: Update the existing §2 → §3 flow**

Currently §2 ends with:
> If there are no warnings at all, show the dashboard and: "Everything looks good — all data is protected."
> If there ARE warnings, proceed to §3.

Replace with:
> If there are no warnings at all, show the dashboard and: "Everything looks good — all data is protected."
> Then show the Action Menu (always, even if no warnings).

- [ ] **Step 3: Commit**

```bash
git add core/skills/sync/SKILL.md
git commit -m "feat(sync): add hub-and-return action menu UX"
```

---

### Task 4: Add §7 — Backend Reconfiguration

Full interactive backend management within `/sync`. Users can add, remove, change, and test backends without re-running setup-wizard.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Add §7 section after §6**

Append the following after §6 (Path Normalization):

```markdown
## §7 — Backend Reconfiguration

Interactive reconfiguration of sync backends. Users should not need to re-run `/setup-wizard` to change their backend setup.

### Step 1: Show current backend config

Read `~/.claude/toolkit-state/config.json` and display:

```
Backend    Status           Config
Drive      ✓ active         gdrive:{DRIVE_ROOT}/Backup/personal/
GitHub     ✓ active         {PERSONAL_SYNC_REPO}
iCloud     not configured   —
```

Show only the three supported backends. Mark as "active" if present in `PERSONAL_SYNC_BACKEND`, "not configured" otherwise.

### Step 2: Ask what they want to do

```
What would you like to do?
  1. Add a backend
  2. Remove a backend
  3. Change backend settings
  4. Test all backends
  5. Back to dashboard
```

### Adding a backend

Ask which backend to add (only show unconfigured ones):

**Drive:**
1. Check if rclone is installed: `command -v rclone &>/dev/null`
   - If missing, show install command for the current platform:
     - Linux: `curl https://rclone.org/install.sh | sudo bash`
     - macOS: `brew install rclone`
     - Windows: `winget install Rclone.Rclone`
   - Wait for user to install, then verify
2. Check if `gdrive:` remote exists: `rclone listremotes | grep -q '^gdrive:'`
   - If missing, walk through: `rclone config create gdrive drive`
   - Verify: `rclone lsd gdrive: 2>/dev/null`
3. Ask for Drive root folder name (default: "Claude")
4. Run round-trip test (see Testing section below)
5. On success, update config:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const backends = (c.PERSONAL_SYNC_BACKEND || '').split(',').filter(Boolean);
  if (!backends.includes('drive')) backends.push('drive');
  c.PERSONAL_SYNC_BACKEND = backends.join(',');
  c.DRIVE_ROOT = process.argv[2];
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
" ~/.claude/toolkit-state/config.json "<drive-root>"
```

**GitHub:**
1. Check if `gh` is installed: `command -v gh &>/dev/null`
2. Check auth: `gh auth status 2>/dev/null`
3. Ask for sync repo URL, or offer to create one:
   ```bash
   GH_USER=$(gh api user -q '.login' 2>/dev/null)
   gh repo create "$GH_USER/claude-personal-sync" --private --description "Personal Claude data backup"
   ```
4. Verify repo exists: `gh repo view "<repo>" --json name 2>/dev/null`
5. Run round-trip test
6. On success, update config:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const backends = (c.PERSONAL_SYNC_BACKEND || '').split(',').filter(Boolean);
  if (!backends.includes('github')) backends.push('github');
  c.PERSONAL_SYNC_BACKEND = backends.join(',');
  c.PERSONAL_SYNC_REPO = process.argv[2];
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
" ~/.claude/toolkit-state/config.json "<repo-url>"
```

**iCloud:**
1. Detect iCloud Drive path:
   ```bash
   # macOS standard
   test -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" && echo "FOUND"
   # Windows iCloud
   test -d "$HOME/iCloudDrive" && echo "FOUND"
   # Linux (rare)
   test -d "$HOME/Apple/CloudDocs" && echo "FOUND"
   ```
2. If not found, ask user for their iCloud Drive path
3. Create sync directory: `mkdir -p "<icloud-path>/DestinClaude"`
4. Run round-trip test
5. On success, update config:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const backends = (c.PERSONAL_SYNC_BACKEND || '').split(',').filter(Boolean);
  if (!backends.includes('icloud')) backends.push('icloud');
  c.PERSONAL_SYNC_BACKEND = backends.join(',');
  c.ICLOUD_PATH = process.argv[2];
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
" ~/.claude/toolkit-state/config.json "<icloud-path>"
```

### Removing a backend

1. Ask which active backend to remove
2. Confirm: "Your data on this backend won't be deleted — it just won't be synced to anymore. Continue?"
3. On confirm:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const remove = process.argv[2];
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const backends = (c.PERSONAL_SYNC_BACKEND || '').split(',').filter(b => b && b !== remove);
  c.PERSONAL_SYNC_BACKEND = backends.length > 0 ? backends.join(',') : 'none';
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
" ~/.claude/toolkit-state/config.json "<backend-name>"
```
4. Confirm removal and show updated backend list

### Changing backend settings

For the selected backend, let the user update its configuration:
- **Drive:** change `DRIVE_ROOT` (the folder name on Google Drive)
- **GitHub:** change `PERSONAL_SYNC_REPO` (the repo URL)
- **iCloud:** change `ICLOUD_PATH`

Update the relevant key in config.json using the same node pattern as above.

### Testing backends (round-trip test)

For each configured backend, run a full round-trip: write → read → verify → delete.

**Important:** Respect the sync mutex. Check if a sync is currently running:
```bash
LOCK_DIR=~/.claude/toolkit-state/.sync-lock
if [[ -d "$LOCK_DIR" ]]; then
    LOCK_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo 0)
    if kill -0 "$LOCK_PID" 2>/dev/null; then
        echo "A sync is currently running (PID $LOCK_PID). Wait for it to finish or skip the test."
        # Offer: wait or skip
    fi
fi
```

**Drive test:**
```bash
TEST_ID=$(date +%s)
TEST_FILE="/tmp/sync-test-$TEST_ID.txt"
echo "sync-test-$TEST_ID" > "$TEST_FILE"

# Write
rclone copyto "$TEST_FILE" "gdrive:{DRIVE_ROOT}/Backup/personal/.sync-test-$TEST_ID.txt" 2>&1
# Read back
rclone cat "gdrive:{DRIVE_ROOT}/Backup/personal/.sync-test-$TEST_ID.txt" 2>&1
# Verify content matches
# Delete
rclone deletefile "gdrive:{DRIVE_ROOT}/Backup/personal/.sync-test-$TEST_ID.txt" 2>&1
rm -f "$TEST_FILE"
```

**GitHub test:**
```bash
REPO_DIR=~/.claude/toolkit-state/personal-sync-repo
TEST_ID=$(date +%s)
echo "sync-test-$TEST_ID" > "$REPO_DIR/.sync-test"
cd "$REPO_DIR" && git add .sync-test && git commit -m "sync test $TEST_ID" --no-gpg-sign
git push personal-sync main 2>&1
# Verify push succeeded
git rm .sync-test && git commit -m "remove sync test" --no-gpg-sign
git push personal-sync main 2>&1
```

**iCloud test:**
```bash
TEST_ID=$(date +%s)
ICLOUD_PATH="<configured-icloud-path>"
echo "sync-test-$TEST_ID" > "$ICLOUD_PATH/.sync-test-$TEST_ID.txt"
# Read back
cat "$ICLOUD_PATH/.sync-test-$TEST_ID.txt"
# Verify content
rm -f "$ICLOUD_PATH/.sync-test-$TEST_ID.txt"
```

**Report results per backend:**
```
Backend    Write   Read    Delete  Latency
Drive      ✓       ✓       ✓       1.2s
GitHub     ✓       ✓       ✓       0.8s
iCloud     ✗       —       —       — (path not found)
```

For failures, show actionable errors:
- Drive auth expired → "Run `rclone config reconnect gdrive:` to refresh credentials"
- GitHub push rejected → "Check repo permissions: `gh repo view <repo> --json viewerPermission`"
- iCloud path missing → "iCloud Drive folder not found. Is iCloud installed and signed in?"

After any add/remove/change/test action, return to the §7 Step 1 display (show updated config) and ask again. When user picks "Back to dashboard", return to the Action Menu (hub return).
```

- [ ] **Step 2: Commit**

```bash
git add core/skills/sync/SKILL.md
git commit -m "feat(sync): add §7 backend reconfiguration"
```

---

### Task 5: Add §8 — Skill Backup Management

Per-skill routing with proactive detection, routing table, and contribute flow.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Add §8 section after §7**

Append after §7:

```markdown
## §8 — Skill Backup Management

Per-skill routing to one of three destinations. The routing manifest at `~/.claude/toolkit-state/skill-routes.json` is the single source of truth.

### Routing options (per skill)

1. **Personal sync** (`"personal"`) — back up to all configured backends via `sync.sh`
2. **Contribute** (`"contribute"`) — fork/branch/PR via `/contribute`, plus kept in personal sync as safety net until PR is merged
3. **No backup** (`"none"`) — skip this skill entirely (lives only on this machine)

### Step 1: Show routing table

Scan `~/.claude/skills/` for all user-created skills (not symlinks, not toolkit copies). For each, look up its route in `skill-routes.json`.

For skills routed as `"contribute"` with a `pr` field, check PR status:
```bash
gh pr view <pr-number> -R itsdestin/destinclaude --json state -q '.state' 2>/dev/null
```

Display:
```
Skill Backup Routing
────────────────────────────────────────────────

Skill                Route              Status
journaling           personal-sync      ✓ synced
elections-notebook    personal-sync      ✓ synced
announce             contribute         PR #72 open
fork-file            none               — skipped
my-new-skill         ⚠ unrouted         —

────────────────────────────────────────────────
```

### Step 2: Handle unrouted skills first

If any skills are unrouted, handle them before offering general management. For each unrouted skill:

> `<name>` has no backup route. Where should it be backed up?
> 1. **Personal sync** — back up to your configured backends
> 2. **Contribute to DestinClaude** — share as a PR (stays in personal sync until merged)
> 3. **No backup** — skip (only on this machine)

Write the choice:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  let routes = {};
  try { routes = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  routes[process.argv[2]] = { route: process.argv[3], since: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(f, JSON.stringify(routes, null, 2) + '\n');
" ~/.claude/toolkit-state/skill-routes.json "<skill-name>" "<personal|contribute|none>"
```

If "Contribute" is chosen:
1. Run the `/contribute` command flow (fork detection, private-manifest filtering, branch, PR)
2. After the PR is created, record the PR number:
```bash
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  let routes = {};
  try { routes = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  routes[process.argv[2]] = { route: 'contribute', pr: parseInt(process.argv[3]), since: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(f, JSON.stringify(routes, null, 2) + '\n');
" ~/.claude/toolkit-state/skill-routes.json "<skill-name>" "<pr-number>"
```

### Step 3: General management

After all unrouted skills are handled (or if there were none), ask:

```
What would you like to do?
  1. Change a skill's route
  2. Back to dashboard
```

If user picks "Change a skill's route":
- Show the routing table again
- Ask which skill to change
- Present the three routing options
- Write the new route to `skill-routes.json` using the same node command
- If changing FROM "contribute" to another route, note that any open PR will remain open — they can close it manually if desired
- If changing TO "contribute", run the contribute flow

After any change, show the updated routing table and ask again. When user picks "Back to dashboard", return to the Action Menu (hub return).
```

- [ ] **Step 2: Commit**

```bash
git add core/skills/sync/SKILL.md
git commit -m "feat(sync): add §8 skill backup management"
```

---

### Task 6: Update §5 force sync for new sync.sh path

The force sync section needs to use the correct marker file and script path.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Verify §5 references**

Check that §5 uses:
- Marker file: `~/.claude/toolkit-state/.sync-marker` (not `.personal-sync-marker`)
- Script path: `~/.claude/hooks/sync.sh` (not `personal-sync.sh`)

The current SKILL.md already uses `.sync-marker` and `sync.sh` (updated in PR #103). If correct, skip this step. If not, update both references.

- [ ] **Step 2: Commit (only if changes were made)**

```bash
git add core/skills/sync/SKILL.md
git commit -m "fix(sync): verify §5 force sync references"
```

---

### Task 7: Update skill description and frontmatter

The skill's trigger description should mention the new capabilities.

**Files:**
- Modify: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Update frontmatter description**

Change the `description` field in the YAML frontmatter to include the new capabilities:

```yaml
---
name: sync
description: Show sync status dashboard and resolve warnings. Manage backend configuration, skill backup routing, and force syncs. Use when user says "/sync", "sync status", "check sync", "backup status", "force sync", "backup now", "conversation sync", "sync my conversations", "cross-device resume", "configure backends", "manage skill backups", "skill routing", when the statusline shows sync warnings, or when a session-start hook reports unsynced projects/skills.
---
```

- [ ] **Step 2: Update the intro paragraph**

The first paragraph currently says:
> You are managing the user's data protection across three categories: system changes (Git), personal data (Drive/GitHub/iCloud), and project repos.

Replace with:
> You are managing the user's data protection. This is an interactive hub — show the status dashboard, present an action menu, handle the user's choice, then return to the dashboard until they're done. The sync system backs up personal data and system config to configured cloud backends (Google Drive, GitHub, iCloud) via `sync.sh`.

- [ ] **Step 3: Remove stale "Git-synced repo" note**

The note that says:
> **Note:** The Git-synced repo (`~/.claude/`) and the Drive remote name (`gdrive:`) are determined by the user's backup configuration.

Replace with:
> **Note:** The Drive remote name (`gdrive:`) and other backend paths are determined by the user's backup configuration in `~/.claude/toolkit-state/config.json`. There is no local git repo at `~/.claude/` — all backups go to cloud backends.

- [ ] **Step 4: Update Parse Arguments**

Add new trigger phrases:
```markdown
## Parse Arguments

Check if the user provided an argument:
- No argument → full status dashboard + action menu
- `now` (or phrases: "backup now", "force sync", "force backup", "run a backup", "sync to Drive") → force sync (skip to §5)
- `add <path>` → register a single project (skip to §4 for that path only)
- `ignore <path>` → add path to ignored list in tracked-projects.json, remove from .unsynced-projects
- `backends` (or "configure backends", "manage backends") → skip to §7
- `skills` (or "skill routing", "manage skill backups", "skill backups") → skip to §8
```

- [ ] **Step 5: Commit**

```bash
git add core/skills/sync/SKILL.md
git commit -m "feat(sync): update frontmatter and intro for sync hub UX"
```

---

### Task 8: Final review and integration test

Verify the complete SKILL.md is internally consistent and the section numbering is correct.

**Files:**
- Read: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Verify section ordering**

Read the complete SKILL.md and confirm:
1. Frontmatter → Parse Arguments → §1 (Setup) → §2 (Dashboard) → Action Menu → §3 (Warnings) → §4 (Projects) → §5 (Force Sync) → §6 (Path Normalization) → §7 (Backend Reconfig) → §8 (Skill Management)
2. No section references a number that doesn't exist
3. The Action Menu correctly maps numbers to sections
4. All hub-return instructions point back to "re-read §1, show §2, show Action Menu"

- [ ] **Step 2: Verify no stale references remain**

Search the file for:
- `git-sync` — should not appear
- `personal-sync.sh` — should not appear (except possibly as historical note)
- `.sync-status` — should not appear
- `.push-marker` — should not appear
- `git -C ~/.claude` — should not appear
- `SKILLS:name1,name2` — should only appear in the new `SKILLS:unrouted:` format

- [ ] **Step 3: Verify config key references**

All config reads should use the correct keys:
- `PERSONAL_SYNC_BACKEND` — comma-separated backend list
- `DRIVE_ROOT` — Drive folder name
- `PERSONAL_SYNC_REPO` — GitHub repo URL
- `ICLOUD_PATH` — iCloud directory path
- Config file at `~/.claude/toolkit-state/config.json` (NOT `config.local.json`)

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add core/skills/sync/SKILL.md
git commit -m "fix(sync): final review corrections"
```

---

### Task 9: Update sync-hub-design plan status

Mark the plan as implemented now that all sections are done.

**Files:**
- Modify: `core/plans/sync-hub-design (03-26-2026).md`

- [ ] **Step 1: Update plan frontmatter**

Change `status: approved` to `status: implemented` and add a changelog entry:

```yaml
  - version: 1.2
    date: 2026-04-05
    summary: "Implemented — SKILL.md rewritten with §7, §8, hub-and-return UX, stale refs removed"
```

- [ ] **Step 2: Commit**

```bash
git add "core/plans/sync-hub-design (03-26-2026).md"
git commit -m "docs: mark sync-hub-design as implemented"
```
