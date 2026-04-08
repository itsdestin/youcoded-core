---
name: sync
description: Show sync status dashboard and resolve warnings. Manage backend configuration, skill backup routing, and force syncs. Use when user says "/sync", "sync status", "check sync", "backup status", "force sync", "backup now", "conversation sync", "sync my conversations", "cross-device resume", "configure backends", "manage backends", "manage skill backups", "skill routing", when the statusline shows sync warnings, or when a session-start hook reports unsynced projects/skills.
---

# /sync — Sync Hub

You are managing the user's data protection. This is an interactive hub — show the status dashboard, present an action menu, handle the user's choice, then return to the dashboard until they're done. The sync system backs up personal data and system config to configured cloud backends (Google Drive, GitHub, iCloud) via `sync.sh`.

**Note:** The Drive remote name (`gdrive:`) and other backend paths are determined by the user's backup configuration in `~/.claude/toolkit-state/config.json`. There is no local git repo at `~/.claude/` — all backups go to cloud backends.

## Parse Arguments

Check if the user provided an argument:
- No argument → full status dashboard + action menu
- `now` (or phrases: "backup now", "force sync", "force backup", "run a backup", "sync to Drive") → force sync (skip to §5)
- `add <path>` → register a single project (skip to §4 for that path only)
- `ignore <path>` → add path to ignored list in tracked-projects.json, remove from .unsynced-projects
- `backends` (or "configure backends", "manage backends") → skip to §7
- `skills` (or "skill routing", "manage skill backups", "skill backups") → skip to §8

## §1 — Setup: Read State Files

Read ALL of these before showing anything:

```bash
cat ~/.claude/.sync-warnings 2>/dev/null        # Active warnings from session-start
cat ~/.claude/backup-meta.json 2>/dev/null       # Last sync metadata
cat ~/.claude/toolkit-state/.sync-marker 2>/dev/null  # Sync debounce timestamp

cat ~/.claude/.unsynced-projects 2>/dev/null     # Discovered but unregistered projects
cat ~/.claude/tracked-projects.json 2>/dev/null  # Project registry (may not exist yet)
cat ~/.claude/toolkit-state/config.json 2>/dev/null  # Backend config
cat ~/.claude/toolkit-state/skill-routes.json 2>/dev/null  # Skill backup routing manifest
tail -20 ~/.claude/backup.log 2>/dev/null        # Recent backup operations
```

Also run live checks:
```bash
# Internet connectivity
node -e 'require("dns").lookup("github.com",e=>{process.exit(e?1:0)})' 2>/dev/null && echo "ONLINE" || echo "OFFLINE"

# Backend reachability (only check configured backends)
# Drive: rclone lsd gdrive: 2>/dev/null
# GitHub: git -C ~/.claude/toolkit-state/personal-sync-repo remote -v 2>/dev/null
# iCloud: test -d "<ICLOUD_PATH>"
```

## §2 — Status Dashboard

Always show this first. Compute relative times from epoch timestamps. Read `PERSONAL_SYNC_BACKEND` from config.json — it's a comma-separated string like `"drive"`, `"drive,github"`, or `"drive,icloud"`.

```
═══════════════════════════════════════════════════
  Sync Status
═══════════════════════════════════════════════════

  Backends:
    Drive: ✓ active → gdrive:{DRIVE_ROOT}/Backup/personal/
    GitHub: ✓ active → {PERSONAL_SYNC_REPO}
    iCloud: ✓ active → {ICLOUD_PATH}
    — OR for each unconfigured backend —
    Drive: not configured
    — OR if no backends at all —
    ⚠ No backends configured — run /setup-wizard or pick "Reconfigure backends" below

  Last Sync:
    Xm ago
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
    — OR —
    No project registry yet

═══════════════════════════════════════════════════
```

For the Skills row, count from `skill-routes.json`: skills with `"route": "personal"` are "synced", `"route": "contribute"` are "contributed", `"route": "none"` are "skipped". Any user-created skill in `~/.claude/skills/` not present in `skill-routes.json` (and not a toolkit symlink/copy) is "unrouted".

If there are no warnings at all, show the dashboard and: "Everything looks good — all data is protected."

Then always show the Action Menu.

## Action Menu

After showing the dashboard, present a contextual action menu. Items 1–3 only appear when their condition is met. Items 4–6 are always available:

```
What would you like to do?

  1. Resolve warnings          ← only if .sync-warnings has entries
  2. Configure skill backups   ← only if unrouted skills exist, or always if user wants to manage routes
  3. Register projects         ← only if .unsynced-projects has entries
  4. Reconfigure backends
  5. Force sync now
  6. Done
```

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

## §3 — Warning Resolution

Walk through each active warning from `.sync-warnings`. Present one at a time, wait for user response.

### OFFLINE
> No internet connection detected. Remote sync is paused.
> This resolves automatically when connectivity returns. No action needed.

### PERSONAL:NOT_CONFIGURED
> Personal data (memory, CLAUDE.md, config) is NOT backed up to any remote.
> If this machine dies, that data is gone.
>
> Options:
> 1. Configure a backend now (goes to §7)
> 2. Run `/setup-wizard` for full guided setup

### PERSONAL:STALE
Diagnose the cause:
1. Check if `sync.sh` is registered as a PostToolUse hook in `~/.claude/settings.json`
2. Check if the backend is reachable (rclone/git)
3. Check the debounce marker age (`~/.claude/toolkit-state/.sync-marker`)
4. Check `backup.log` for recent errors

Report what you find, then offer:
> Options:
> 1. Force a sync now (resets debounce, runs sync immediately — goes to §5)
> 2. Show recent backup.log entries for debugging

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

If the user picks "Contribute", also run the `/contribute` command flow to create the PR. After the PR is created, record the PR number:
```bash
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

### PROJECTS:N
Transition to §4 — Project Onboarding.

## §4 — Project Onboarding

Read `~/.claude/.unsynced-projects`. If the file doesn't exist or is empty, report "No unsynced projects detected" and return to Action Menu.

If `~/.claude/tracked-projects.json` doesn't exist, create it:
```json
{
  "projects": [],
  "ignored": []
}
```

For each unsynced project path, determine its status:
```bash
# Is it a git repo?
git -C "<path>" rev-parse --git-dir 2>/dev/null

# Does it have a remote?
git -C "<path>" remote get-url origin 2>/dev/null

# If it has a remote and gh is available, check visibility
gh repo view "<owner>/<repo>" --json isPrivate -q '.isPrivate' 2>/dev/null
```

Present each project one at a time:

**Git repo with remote:**
> `<path>` → `<remote>` (private/public). Register for tracking? (yes / ignore)

**Git repo, no remote:**
> `<path>` is a Git repo with no remote.
> 1. Create private GitHub repo and register
> 2. Create public GitHub repo and register
> 3. Ignore this project
> 4. Skip for now

**Not a git repo:**
> `<path>` is not a Git repo.
> 1. Initialize Git + create private repo + register
> 2. Initialize Git + create public repo + register
> 3. Ignore
> 4. Skip

### Execution

Before creating repos, verify `gh` is available:
```bash
command -v gh &>/dev/null || echo "GitHub CLI (gh) not found — install from https://cli.github.com/"
```

Get the GitHub username dynamically:
```bash
GH_USER=$(gh api user -q '.login' 2>/dev/null)
```

**Initialize Git (if needed):**
```bash
cd "<path>" && git init && git add -A && git commit -m "Initial commit"
```

**Create GitHub repo:**
```bash
# Private:
gh repo create "$GH_USER/<basename>" --private --source="<path>" --remote=origin --push
# Public:
gh repo create "$GH_USER/<basename>" --public --source="<path>" --remote=origin --push
```

**Register in tracked-projects.json:**
```bash
node -e "
    const fs = require('fs');
    const regPath = process.argv[1];
    const projPath = process.argv[2];
    const remote = process.argv[3] || '';
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    reg.projects.push({ path: projPath, remote: remote, registered: new Date().toISOString() });
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');
" ~/.claude/tracked-projects.json "<normalized-path>" "<owner/repo>"
```

**Ignore a project:**
```bash
node -e "
    const fs = require('fs');
    const regPath = process.argv[1];
    const projPath = process.argv[2];
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    if (!reg.ignored) reg.ignored = [];
    if (!reg.ignored.includes(projPath)) reg.ignored.push(projPath);
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');
" ~/.claude/tracked-projects.json "<normalized-path>"
```

### Cleanup

After all projects are resolved:
1. Remove resolved entries from `~/.claude/.unsynced-projects` (delete file if all resolved)
2. The updated `tracked-projects.json` will be synced to cloud backends on the next `sync.sh` cycle

## §5 — Force Sync

Triggered by `/sync now` or trigger phrases ("backup now", "force a full backup", "run a backup", "manual backup", "sync to Drive").

```bash
# Reset debounce marker so sync.sh will fire immediately
touch -t 202001010000 ~/.claude/toolkit-state/.sync-marker 2>/dev/null

# Run sync directly
bash ~/.claude/hooks/sync.sh <<< '{"tool_input":{"file_path":"'"$HOME/.claude/CLAUDE.md"'"}}'
```

Report results:
```
Force sync complete:
  Personal data: ✓ synced to Drive / ⚠ failed
```

Check `backup.log` for details if there were errors.

## §6 — Path Normalization

All paths stored in `tracked-projects.json` must be normalized. Use this before storing:
```bash
# Normalize: backslashes to forward slashes, resolve symlinks
normalize_path() {
    local p="$1"
    p="${p//\\//}"
    realpath "$p" 2>/dev/null || readlink -f "$p" 2>/dev/null || echo "$p"
}
```

This matches the `normalize_path()` function in `lib/backup-common.sh`.

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

Show all three supported backends. Mark as "active" if present in `PERSONAL_SYNC_BACKEND`, "not configured" otherwise. For active backends, show the relevant config value.

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
READBACK=$(rclone cat "gdrive:{DRIVE_ROOT}/Backup/personal/.sync-test-$TEST_ID.txt" 2>&1)
# Verify content matches "sync-test-$TEST_ID"
# Delete
rclone deletefile "gdrive:{DRIVE_ROOT}/Backup/personal/.sync-test-$TEST_ID.txt" 2>&1
rm -f "$TEST_FILE"
```

**GitHub test:**
```bash
REPO_DIR=~/.claude/toolkit-state/personal-sync-repo
TEST_ID=$(date +%s)
echo "sync-test-$TEST_ID" > "$REPO_DIR/.sync-test"
cd "$REPO_DIR" && git add .sync-test && git commit -m "sync test $TEST_ID" --no-gpg-sign 2>&1
git push personal-sync main 2>&1
# Verify push succeeded, then clean up
git rm .sync-test && git commit -m "remove sync test" --no-gpg-sign 2>&1
git push personal-sync main 2>&1
```

**iCloud test:**
```bash
TEST_ID=$(date +%s)
ICLOUD_PATH="<configured-icloud-path>"
echo "sync-test-$TEST_ID" > "$ICLOUD_PATH/.sync-test-$TEST_ID.txt"
# Read back
READBACK=$(cat "$ICLOUD_PATH/.sync-test-$TEST_ID.txt")
# Verify content matches "sync-test-$TEST_ID"
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

After any add/remove/change/test action, return to §7 Step 1 (show updated config) and ask again. When user picks "Back to dashboard", return to the Action Menu (hub return).

## §8 — Skill Backup Management

Per-skill routing to one of three destinations. The routing manifest at `~/.claude/toolkit-state/skill-routes.json` is the single source of truth for skill backup decisions. The hooks (`sync.sh`, `session-start.sh`, `contribution-detector.sh`) all read this file.

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
- If changing TO "contribute", run the `/contribute` flow

After any change, show the updated routing table and ask again. When user picks "Back to dashboard", return to the Action Menu (hub return).
