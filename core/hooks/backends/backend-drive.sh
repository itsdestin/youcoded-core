#!/usr/bin/env bash
# backend-drive.sh — Google Drive backend driver for backup engine
# Implements: backup_push, backup_pull, backup_check
# Requires: rclone configured with gdrive: remote

# Read DRIVE_ROOT from config (passed as env var by engine)
# DRIVE_ROOT is set by the calling engine before sourcing this driver

BACKUP_REMOTE="gdrive:${DRIVE_ROOT:-Claude}/Backup"

backup_check() {
    # Return 0 if Drive backend is reachable and configured
    if ! command -v rclone &>/dev/null; then
        echo "rclone not installed" >&2
        return 1
    fi
    if ! rclone lsd "gdrive:" &>/dev/null 2>&1; then
        echo "rclone gdrive: remote not configured or unreachable" >&2
        return 1
    fi
    return 0
}

backup_push() {
    local LOCAL_PATH="$1"
    local REMOTE_PATH="$2"
    local FULL_REMOTE="$BACKUP_REMOTE/$REMOTE_PATH"

    if [[ -d "$LOCAL_PATH" ]]; then
        rclone sync "$LOCAL_PATH" "$FULL_REMOTE" --checksum 2>&1
    elif [[ -f "$LOCAL_PATH" ]]; then
        rclone copyto "$LOCAL_PATH" "$FULL_REMOTE" --checksum 2>&1
    else
        echo "Local path does not exist: $LOCAL_PATH" >&2
        return 1
    fi
}

backup_pull() {
    local REMOTE_PATH="$1"
    local LOCAL_PATH="$2"
    local FULL_REMOTE="$BACKUP_REMOTE/$REMOTE_PATH"

    # Create local directory if needed
    local LOCAL_DIR
    if [[ "$REMOTE_PATH" == */ ]]; then
        LOCAL_DIR="$LOCAL_PATH"
    else
        LOCAL_DIR=$(dirname "$LOCAL_PATH")
    fi
    mkdir -p "$LOCAL_DIR"

    if [[ "$REMOTE_PATH" == */ ]]; then
        # Directory sync
        rclone sync "$FULL_REMOTE" "$LOCAL_PATH" --update 2>&1
    else
        # Single file
        rclone copyto "$FULL_REMOTE" "$LOCAL_PATH" --update 2>&1
    fi
}
