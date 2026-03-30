#!/usr/bin/env bash
# session-end-sync.sh — Sync the current session's JSONL at session exit.
# Ensures conversations from read-only/Bash-only sessions are backed up.
# Bypasses debounce (session is ending — no retry opportunity).
# Hard timeout: 15 seconds (enforced by settings.json timeout property).

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HOOK_DIR/lib/hook-preamble.sh" ]] && source "$HOOK_DIR/lib/hook-preamble.sh"
[[ -f "$HOOK_DIR/lib/backup-common.sh" ]] && source "$HOOK_DIR/lib/backup-common.sh"

# Read hook payload for session context
SESSION_ID=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).session_id||'')}catch{console.log('')}})" 2>/dev/null)
[[ -z "$SESSION_ID" ]] && exit 0

# Check backend
BACKEND=$(config_get "personal_sync_backend" "none")
[[ "$BACKEND" == "none" ]] && exit 0

DRIVE_ROOT=$(config_get "drive_root" "")
[[ -z "$DRIVE_ROOT" ]] && exit 0

SLUG=$(get_current_project_slug 2>/dev/null || echo "")
[[ -z "$SLUG" ]] && exit 0

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
JSONL_FILE="$CLAUDE_DIR/projects/$SLUG/$SESSION_ID.jsonl"
[[ ! -f "$JSONL_FILE" ]] && exit 0

REMOTE_BASE="$DRIVE_ROOT/Backup/personal/conversations/$SLUG"

# Single-file sync — no debounce, no snapshot needed (session is ending, no more writes)
_capture_err "session-end sync $SESSION_ID" \
    rclone copy "$JSONL_FILE" "$REMOTE_BASE/" --checksum || true

log_backup "INFO" "Session-end sync for $SESSION_ID" "sync.sessionend"
