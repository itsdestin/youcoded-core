#!/usr/bin/env bash
# backend-github.sh — Private GitHub repo backend driver for backup engine
# Implements: backup_push, backup_pull, backup_check
# Requires: git installed, BACKUP_REPO_URL set by engine

# BACKUP_REPO_URL and BACKUP_REPO_DIR are set by the calling engine
BACKUP_REPO_DIR="${BACKUP_REPO_DIR:-$HOME/.claude/toolkit-state/backup-repo}"

backup_check() {
    if ! command -v git &>/dev/null; then
        echo "git not installed" >&2
        return 1
    fi
    if [[ -z "${BACKUP_REPO_URL:-}" ]]; then
        echo "No backup repo URL configured" >&2
        return 1
    fi
    # Check if repo is cloned
    if [[ ! -d "$BACKUP_REPO_DIR/.git" ]]; then
        # Try to clone
        if ! git clone "$BACKUP_REPO_URL" "$BACKUP_REPO_DIR" 2>&1; then
            echo "Cannot clone backup repo: $BACKUP_REPO_URL" >&2
            return 1
        fi
    fi
    return 0
}

backup_push() {
    local LOCAL_PATH="$1"
    local REMOTE_PATH="$2"
    local TARGET="$BACKUP_REPO_DIR/$REMOTE_PATH"

    # Ensure target directory exists
    local TARGET_DIR
    if [[ -d "$LOCAL_PATH" ]]; then
        TARGET_DIR="$TARGET"
    else
        TARGET_DIR=$(dirname "$TARGET")
    fi
    mkdir -p "$TARGET_DIR"

    # Copy local → repo checkout
    if [[ -d "$LOCAL_PATH" ]]; then
        # Sync directory (delete removed files)
        rsync -a --delete "$LOCAL_PATH/" "$TARGET/" 2>/dev/null || cp -R "$LOCAL_PATH/." "$TARGET/"
    else
        cp "$LOCAL_PATH" "$TARGET"
    fi

    # Commit and push
    cd "$BACKUP_REPO_DIR" || return 1
    git add -A
    if ! git diff --cached --quiet 2>/dev/null; then
        git commit -m "auto: backup $(date +%Y-%m-%dT%H:%M:%S)" --no-gpg-sign 2>&1
        git push origin main 2>&1 || {
            echo "Push failed — will retry next cycle" >&2
            return 1
        }
    fi
}

backup_pull() {
    local REMOTE_PATH="$1"
    local LOCAL_PATH="$2"

    # Ensure repo is up to date
    if [[ -d "$BACKUP_REPO_DIR/.git" ]]; then
        cd "$BACKUP_REPO_DIR" || return 1
        git pull origin main 2>&1 || {
            echo "Pull failed" >&2
            return 1
        }
    else
        echo "Backup repo not cloned" >&2
        return 1
    fi

    local SOURCE="$BACKUP_REPO_DIR/$REMOTE_PATH"
    [[ ! -e "$SOURCE" ]] && return 0  # Nothing to pull

    local LOCAL_DIR
    if [[ "$REMOTE_PATH" == */ ]]; then
        LOCAL_DIR="$LOCAL_PATH"
    else
        LOCAL_DIR=$(dirname "$LOCAL_PATH")
    fi
    mkdir -p "$LOCAL_DIR"

    if [[ -d "$SOURCE" ]]; then
        rsync -a "$SOURCE/" "$LOCAL_PATH/" 2>/dev/null || cp -R "$SOURCE/." "$LOCAL_PATH/"
    else
        cp "$SOURCE" "$LOCAL_PATH"
    fi
}
