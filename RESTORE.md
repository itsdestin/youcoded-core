# Restoring DestinClaude

If you lose your setup or move to a new device, here's how to get your data back.

## Quickest Path

Run the setup wizard — it asks if you're a returning user and walks you through restore:

```
/setup-wizard
```

Or use the standalone restore command on an existing install:

```
/restore
```

## What Gets Backed Up

| Data | Location | Backed Up By |
|------|----------|-------------|
| Claude Code config (.claude/) | Git repo (private) | `git-sync.sh` (PostToolUse) |
| Memory files, CLAUDE.md | Git repo + configured backends | `personal-sync.sh` |
| Encyclopedia source files | Google Drive (`<DRIVE_ROOT>/The Journal/System/`) | `sync-encyclopedia.sh` |
| Toolkit state (config.json) | Git repo | `git-sync.sh` |

## Backup Backends

Personal data can replicate to one or more of these backends (configured in `config.json`):

1. **Google Drive** — via rclone (`gdrive:` remote). Files go to `<DRIVE_ROOT>/Backup/personal/`.
2. **GitHub** — private config repo. Committed and pushed by `git-sync.sh`.
3. **iCloud** — via iCloud Drive folder detection. macOS: `~/Library/Mobile Documents/com~apple~CloudDocs/DestinClaude/`. Windows: `~/iCloudDrive/DestinClaude/`.

## Architecture

```
~/.claude/
├── hooks/
│   ├── lib/
│   │   ├── backup-common.sh    # Shared utilities (config reading, path normalization)
│   │   └── migrate.sh          # Migration framework
│   └── migrations/
│       └── v1.json             # Schema migrations
├── toolkit-state/
│   ├── config.json             # Backend config, DRIVE_ROOT, installed layers
│   └── backup-meta.json        # Schema version, last migration timestamp
```

## Manual Restore

If the wizard isn't available, restore manually:

### From GitHub
```bash
git clone <your-private-config-repo> ~/.claude
```

### From Google Drive
```bash
rclone sync "gdrive:<DRIVE_ROOT>/Backup/personal/" ~/.claude/ --progress
```

### From iCloud (macOS)
```bash
cp -R ~/Library/Mobile\ Documents/com~apple~CloudDocs/DestinClaude/* ~/.claude/
```

After manual restore, run `/setup-wizard` to re-create symlinks and verify the installation.
