# Sync Skill + Project Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore and modernize the `/sync` skill — providing a status dashboard, warning resolution, project onboarding, and force-sync — while fixing the project tracking gap in `session-start.sh`.

**Architecture:** The sync skill (`core/skills/sync/SKILL.md`) is a Claude Code skill that reads state files written by existing hooks and provides an interactive UI for diagnosis and resolution. It does NOT duplicate hook logic. A companion fix to `session-start.sh` adds project discovery so `.unsynced-projects` is actually populated. The skill goes in `core/skills/` since it's fundamental backup infrastructure.

**Tech Stack:** Bash (hooks), Claude Code skill (markdown), Node.js (JSON manipulation in hooks)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `core/skills/sync/SKILL.md` | **Create** | The sync skill — status dashboard, warning resolution, project onboarding, force sync |
| `core/hooks/session-start.sh` | **Modify** (lines 344-364) | Add project discovery logic that actually writes `.unsynced-projects` |
| `core/hooks/lib/backup-common.sh` | **Modify** (append) | Add `discover_projects()` helper function |

No test files — skills are markdown prompts, not executable code. Hook changes are tested via manual invocation.

---

### Task 1: Add `discover_projects()` to backup-common.sh

The core problem: `session-start.sh` reads `.unsynced-projects` and `tracked-projects.json` but nothing writes them. We need a function that scans common locations for git repos and outputs paths not already tracked.

**Files:**
- Modify: `core/hooks/lib/backup-common.sh` (append after `get_primary_backend` function, ~line 203)

- [ ] **Step 1: Add `discover_projects()` function to backup-common.sh**

Append this after the existing `get_primary_backend()` function:

```bash
# --- Project discovery ---
# Scans common working directories for git repos not already tracked by git-sync.
# Outputs one path per line to stdout. Does NOT write any files.
# Arguments: none (reads tracked-projects.json and git-sync hardcoded paths)
discover_projects() {
    local tracked_file="$CLAUDE_DIR/tracked-projects.json"

    # Build skip set: hardcoded git-sync paths + registered + ignored
    local -a skip_paths=()
    skip_paths+=("$(normalize_path "$CLAUDE_DIR")")
    skip_paths+=("$(normalize_path "$HOME/claude-mobile")")

    if [[ -f "$tracked_file" ]] && command -v node &>/dev/null; then
        while IFS= read -r p; do
            [[ -n "$p" ]] && skip_paths+=("$p")
        done < <(node -e "
            const fs = require('fs');
            try {
                const reg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
                for (const p of (reg.projects || [])) { if (p.path) console.log(p.path); }
                for (const p of (reg.ignored || [])) { console.log(p); }
            } catch {}
        " "$tracked_file" 2>/dev/null)
    fi

    # Scan common directories (depth 1 — only direct children)
    local -a scan_dirs=()
    [[ -d "$HOME/projects" ]] && scan_dirs+=("$HOME/projects")
    [[ -d "$HOME/repos" ]] && scan_dirs+=("$HOME/repos")
    [[ -d "$HOME/code" ]] && scan_dirs+=("$HOME/code")
    [[ -d "$HOME/dev" ]] && scan_dirs+=("$HOME/dev")
    [[ -d "$HOME/src" ]] && scan_dirs+=("$HOME/src")
    [[ -d "$HOME/Documents" ]] && scan_dirs+=("$HOME/Documents")
    [[ -d "$HOME/Desktop" ]] && scan_dirs+=("$HOME/Desktop")

    for scan_dir in "${scan_dirs[@]}"; do
        for candidate in "$scan_dir"/*/; do
            [[ ! -d "$candidate" ]] && continue
            [[ ! -d "$candidate/.git" ]] && continue

            local norm_path
            norm_path=$(normalize_path "${candidate%/}")

            # Check skip set
            local skip=false
            for sp in "${skip_paths[@]}"; do
                [[ "$norm_path" == "$sp" ]] && { skip=true; break; }
            done
            "$skip" && continue

            echo "$norm_path"
        done
    done
}
```

- [ ] **Step 2: Verify the function is syntactically valid**

Run: `bash -n $TOOLKIT_ROOT/core/hooks/lib/backup-common.sh`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
cd $TOOLKIT_ROOT
git add core/hooks/lib/backup-common.sh
git commit -m "feat(backup): add discover_projects() helper for project tracking"
```

---

### Task 2: Wire project discovery into session-start.sh

Currently lines 344-364 of `session-start.sh` read `.unsynced-projects` but nothing writes it. Replace that block with active discovery.

**Files:**
- Modify: `core/hooks/session-start.sh` (replace lines 344-364)

- [ ] **Step 1: Replace the unsynced projects section in session-start.sh**

Replace this block (lines 344-364):
```bash
# 3. Unsynced projects (dedup, filter blanks, filter ignored/registered paths from registry)
if [[ -s "$CLAUDE_DIR/.unsynced-projects" ]]; then
    ...existing code reading .unsynced-projects...
fi
```

With:
```bash
# 3. Unsynced projects — discover git repos not tracked by git-sync or registered
if type discover_projects &>/dev/null; then
    _DISCOVERED=$(discover_projects 2>/dev/null) || _DISCOVERED=""
    if [[ -n "$_DISCOVERED" ]]; then
        # Write discovered paths for the /sync skill to consume
        echo "$_DISCOVERED" | sort -u > "$CLAUDE_DIR/.unsynced-projects"
        _UP_COUNT=$(echo "$_DISCOVERED" | wc -l | tr -d ' ')
        [[ "$_UP_COUNT" -gt 0 ]] && echo "PROJECTS:$_UP_COUNT" >> "$WARNINGS_FILE"
    else
        rm -f "$CLAUDE_DIR/.unsynced-projects" 2>/dev/null
    fi
fi
```

- [ ] **Step 2: Verify session-start.sh parses cleanly**

Run: `bash -n $TOOLKIT_ROOT/core/hooks/session-start.sh`
Expected: No output (clean parse)

- [ ] **Step 3: Test project discovery manually**

Run: `source $TOOLKIT_ROOT/core/hooks/lib/backup-common.sh && discover_projects`
Expected: List of git repo paths found in ~/projects/, ~/repos/, ~/code/, ~/dev/, ~/src/, ~/Documents/, ~/Desktop/ (may be empty if no repos exist there)

- [ ] **Step 4: Commit**

```bash
cd $TOOLKIT_ROOT
git add core/hooks/session-start.sh
git commit -m "feat(session-start): active project discovery replaces passive .unsynced-projects read"
```

---

### Task 3: Create the sync skill

The main deliverable. A Claude Code skill at `core/skills/sync/SKILL.md`.

**Files:**
- Create: `core/skills/sync/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run: `mkdir -p $TOOLKIT_ROOT/core/skills/sync`

- [ ] **Step 2: Write SKILL.md**

Create `core/skills/sync/SKILL.md` with the following content:

````markdown
---
name: sync
description: Show sync status dashboard and resolve warnings. Use when user says "/sync", "sync status", "check sync", "backup status", "force sync", "backup now", when the statusline shows sync warnings, or when a session-start hook reports unsynced projects/skills.
---

# /sync — Sync Status & Data Protection

You are managing the user's data protection across three categories: system changes (Git), personal data (Drive/GitHub/iCloud), and project repos. The goal: the user should never lose information.

## Parse Arguments

Check if the user provided an argument:
- No argument → full status dashboard + guided resolution
- `now` (or phrases: "backup now", "force sync", "force backup", "run a backup", "sync to Drive") → force sync (skip to §5)
- `add <path>` → register a single project (skip to §4 for that path only)
- `ignore <path>` → add path to ignored list in tracked-projects.json, remove from .unsynced-projects, commit

## §1 — Setup: Read State Files

Read ALL of these before showing anything:

```bash
cat ~/.claude/.sync-warnings 2>/dev/null        # Active warnings from session-start
cat ~/.claude/.sync-status 2>/dev/null           # Git sync status line
cat ~/.claude/backup-meta.json 2>/dev/null       # Last personal sync metadata
cat ~/.claude/toolkit-state/.personal-sync-marker 2>/dev/null  # Personal sync debounce timestamp
cat ~/.claude/.push-marker 2>/dev/null           # Git-sync push debounce timestamp
cat ~/.claude/.push-marker-claude-mobile 2>/dev/null  # Claude Mobile push marker
cat ~/.claude/.unsynced-projects 2>/dev/null     # Discovered but unregistered projects
cat ~/.claude/tracked-projects.json 2>/dev/null  # Project registry (may not exist yet)
cat ~/.claude/toolkit-state/config.json 2>/dev/null  # Backend config
tail -20 ~/.claude/backup.log 2>/dev/null        # Recent backup operations
```

Also run live checks:
```bash
# Internet connectivity
node -e 'require("dns").lookup("github.com",e=>{process.exit(e?1:0)})' 2>/dev/null && echo "ONLINE" || echo "OFFLINE"

# Git-sync remote status
git -C ~/.claude remote get-url origin 2>/dev/null

# Personal sync backend reachability (only check configured backends)
# Drive: rclone lsd gdrive: 2>/dev/null
# GitHub: git -C ~/.claude/toolkit-state/personal-sync-repo remote -v 2>/dev/null
# iCloud: test -d "$ICLOUD_PATH"
```

## §2 — Status Dashboard

Always show this first. Compute relative times from epoch timestamps.

```
═══════════════════════════════════════════════════
  Sync Status
═══════════════════════════════════════════════════

  System (Git):
    ✓ ~/.claude → origin (last push: Xm ago)
    ✓ ~/claude-mobile → origin (last push: Xh ago)
    — OR —
    ⚠ No remote configured

  Personal Data:
    Backend: Google Drive
    Last sync: Xm ago → gdrive:Claude/Backup/personal/
    Status: ✓ OK
    — OR —
    ⚠ Not configured — run /setup-wizard
    — OR —
    ⚠ Stale (last sync: Xd ago)

  Skills:
    ✓ N toolkit-managed, M git-tracked
    — OR —
    ⚠ N unbackedup: name1, name2

  Projects:
    N tracked, M unsynced detected
    — OR —
    ✓ All projects tracked (N total)
    — OR —
    No project registry yet

═══════════════════════════════════════════════════
```

If there are no warnings at all, show the dashboard and: "Everything looks good — all data is protected."

If there ARE warnings, proceed to §3.

## §3 — Warning Resolution

Walk through each active warning. Present one at a time, wait for user response.

### OFFLINE
> No internet connection detected. Git push and remote sync are paused — local commits continue normally.
> This resolves automatically when connectivity returns. No action needed.

### PERSONAL:NOT_CONFIGURED
> Personal data (memory, CLAUDE.md, config) is NOT backed up to any remote.
> If this machine dies, that data is gone.
>
> Run `/setup-wizard` to configure a backend (Google Drive, GitHub, or iCloud).

### PERSONAL:STALE
Diagnose the cause:
1. Check if `personal-sync.sh` is registered as a PostToolUse hook in `~/.claude/settings.json`
2. Check if the backend is reachable (rclone/git)
3. Check the debounce marker age
4. Check `backup.log` for recent errors

Report what you find, then offer:
> Options:
> 1. Force a sync now (resets debounce, runs sync immediately)
> 2. Show recent backup.log entries for debugging

### SKILLS:name1,name2
For each unbackedup skill:
> `<name>` exists at `~/.claude/skills/<name>/` but is not backed up anywhere.
> It's not a toolkit symlink and not tracked by git.
>
> Options:
> 1. Add to git tracking (recommended — backed up with your other config)
> 2. Skip for now

If user picks 1:
```bash
cd ~/.claude && git add "skills/<name>/" && git commit -m "feat: track user skill <name>" --no-gpg-sign
```

### PROJECTS:N
Transition to §4 — Project Onboarding.

## §4 — Project Onboarding

Read `~/.claude/.unsynced-projects`. If the file doesn't exist or is empty, report "No unsynced projects detected" and skip.

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
2. If `tracked-projects.json` changed:
```bash
cd ~/.claude && git add tracked-projects.json && git commit -m "auto: update tracked-projects.json" --no-gpg-sign
```

## §5 — Force Sync

Triggered by `/sync now` or trigger phrases ("backup now", "force a full backup", "run a backup", "manual backup", "sync to Drive").

```bash
# Reset debounce markers so hooks will fire immediately
touch -t 202001010000 ~/.claude/toolkit-state/.personal-sync-marker 2>/dev/null
touch -t 202001010000 ~/.claude/.push-marker 2>/dev/null
touch -t 202001010000 ~/.claude/.push-marker-claude-mobile 2>/dev/null

# Run git-sync for each tracked repo
cd ~/.claude && git add -A 2>/dev/null && git diff --cached --quiet 2>/dev/null || git commit -m "manual: force sync" --no-gpg-sign 2>/dev/null
git push origin $(git symbolic-ref --short HEAD) 2>/dev/null && echo "✓ Git push: ~/.claude" || echo "⚠ Git push failed: ~/.claude"

if [ -d ~/claude-mobile/.git ]; then
    cd ~/claude-mobile && git add -A 2>/dev/null && git diff --cached --quiet 2>/dev/null || git commit -m "manual: force sync" --no-gpg-sign 2>/dev/null
    git push origin $(git symbolic-ref --short HEAD) 2>/dev/null && echo "✓ Git push: ~/claude-mobile" || echo "⚠ Git push failed: ~/claude-mobile"
fi

# Run personal-sync directly
bash ~/.claude/hooks/personal-sync.sh <<< '{"tool_input":{"file_path":"'"$HOME/.claude/CLAUDE.md"'"}}'
```

Report results:
```
Force sync complete:
  Git (claude-config): ✓ pushed
  Git (claude-mobile): ✓ pushed / ⚠ failed / — not found
  Personal data: ✓ synced to Drive / ⚠ failed
```

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
````

- [ ] **Step 3: Verify the skill file exists and is well-formed**

Run: `head -5 $TOOLKIT_ROOT/core/skills/sync/SKILL.md`
Expected: YAML frontmatter with name: sync

- [ ] **Step 4: Commit**

```bash
cd $TOOLKIT_ROOT
git add core/skills/sync/
git commit -m "feat: add /sync skill — status dashboard, warning resolution, project onboarding, force sync"
```

---

### Task 4: Create symlink in ~/.claude/skills/

The skill needs to be accessible to Claude Code via the skills directory.

**Files:**
- Create: `~/.claude/skills/sync` (symlink → toolkit repo)

- [ ] **Step 1: Set MSYS symlink mode and create the symlink**

```bash
export MSYS=winsymlinks:nativestrict
ln -sf $TOOLKIT_ROOT/core/skills/sync ~/.claude/skills/sync
```

- [ ] **Step 2: Verify symlink resolves**

Run: `ls -la ~/.claude/skills/sync/SKILL.md`
Expected: File exists and is readable

- [ ] **Step 3: Commit the symlink to the config repo**

```bash
cd ~/.claude && git add skills/sync && git commit -m "feat: link sync skill"
```

---

### Task 5: Verify end-to-end

No new files — just validation.

- [ ] **Step 1: Verify session-start project discovery works**

```bash
source $TOOLKIT_ROOT/core/hooks/lib/backup-common.sh
discover_projects
```

Expected: Either a list of untracked repo paths or empty output (both valid)

- [ ] **Step 2: Verify the sync skill is invocable**

The skill should appear in Claude Code's skill list. Invoke with `/sync` and verify the status dashboard renders.

- [ ] **Step 3: Check that .sync-warnings is still written correctly**

Run session-start manually:
```bash
bash $TOOLKIT_ROOT/core/hooks/session-start.sh 2>&1 | head -20
```

Verify `~/.claude/.sync-warnings` is created/updated.

- [ ] **Step 4: Verify force sync path**

Test that the force sync markers exist and can be reset:
```bash
cat ~/.claude/.push-marker 2>/dev/null && echo "OK" || echo "No marker yet"
cat ~/.claude/toolkit-state/.personal-sync-marker 2>/dev/null && echo "OK" || echo "No marker yet"
```

---

### Task 6: System Change Protocol

Per CLAUDE.md mandate, follow the system change checklist before claiming done.

- [ ] **Step 1: Read the system change checklist**

Read `~/.claude/docs/system.md` and verify all items are addressed.

- [ ] **Step 2: Verify CLAUDE.md skill table is correct**

The `sync` entry already exists in `~/.claude/CLAUDE.md`. Verify the description matches the new skill's actual functionality. Update if needed to:
```
| `sync` | Sync status dashboard, warning resolution, project onboarding, force sync |
```

- [ ] **Step 3: Check if spec is needed**

The sync skill is a prompt-only skill with no hook logic of its own — it reads state files and runs interactive flows. The project discovery logic lives in `backup-common.sh` which is covered by `backup-system-spec.md`. A separate spec is likely not needed, but offer to create one if the user wants it.

- [ ] **Step 4: Verify existing specs are still accurate**

Check `backup-system-spec.md` and `personal-sync-spec.md` — the project discovery addition should be reflected. Specifically:
- `backup-system-spec.md` mandate (line 20): "All Claude projects MUST be backed up to a private GitHub repo by default. When a new project is created, it should be added to git-sync.sh's project routing." — The sync skill now provides the mechanism for this.
- No spec changes needed unless the user approves them.
