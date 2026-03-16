#!/bin/bash
# SessionStart hook: detect toolkit changes that could be contributed upstream
# Outputs CONTRIBUTION_AVAILABLE context if new meaningful changes are found
set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
STATE_DIR="$CLAUDE_DIR/toolkit-state"
TRACKER="$STATE_DIR/contribution-tracker.json"
TOOLKIT_ROOT=""

# --- Find toolkit root directory ---
# Walk up from this script's location to find VERSION file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARCH="$SCRIPT_DIR"
for _ in 1 2 3 4 5; do
    if [[ -f "$SEARCH/VERSION" ]]; then
        TOOLKIT_ROOT="$SEARCH"
        break
    fi
    SEARCH="$(dirname "$SEARCH")"
done

[[ -z "$TOOLKIT_ROOT" ]] && exit 0

# --- Read installed version ---
INSTALLED_VERSION=$(cat "$TOOLKIT_ROOT/VERSION" 2>/dev/null | tr -d '[:space:]')
[[ -z "$INSTALLED_VERSION" ]] && exit 0
INSTALLED_TAG="v${INSTALLED_VERSION}"

# --- Ensure tracker file exists ---
mkdir -p "$STATE_DIR"
if [[ ! -f "$TRACKER" ]]; then
    cat > "$TRACKER" << 'INIT'
{
  "installed_version": "v0.1.0",
  "suggested": {},
  "declined": {},
  "contributed": {}
}
INIT
fi

# --- Check if we're in a git repo with tags ---
cd "$TOOLKIT_ROOT"
git rev-parse --git-dir &>/dev/null || exit 0
git tag -l "$INSTALLED_TAG" &>/dev/null || exit 0

# --- Get changed files since installed tag ---
CHANGED_FILES=$(git diff --name-only "$INSTALLED_TAG"..HEAD -- core/ life/ productivity/ modules/ 2>/dev/null) || exit 0
[[ -z "$CHANGED_FILES" ]] && exit 0

# --- Read private manifest patterns ---
PRIVATE_PATTERNS=""
if [[ -f "$TOOLKIT_ROOT/.private-manifest" ]]; then
    PRIVATE_PATTERNS=$(grep -v '^#' "$TOOLKIT_ROOT/.private-manifest" | grep -v '^$' | tr -d '\r')
fi

# --- Filter and check each changed file ---
NEW_CHANGES=()
while IFS= read -r filepath; do
    [[ -z "$filepath" ]] && continue

    # Skip files matching private patterns
    SKIP=false

    # Always-excluded patterns
    case "$filepath" in
        */encyclopedia/*|*/journal/*|*/memory/*|*/.env|*token*|*secret*|*credential*|*/.private/*)
            SKIP=true ;;
    esac

    # Check against .private-manifest patterns
    if [[ "$SKIP" == "false" && -n "$PRIVATE_PATTERNS" ]]; then
        while IFS= read -r pattern; do
            [[ -z "$pattern" ]] && continue
            # Simple glob matching using bash pattern
            # shellcheck disable=SC2254
            case "$filepath" in
                $pattern) SKIP=true; break ;;
            esac
        done <<< "$PRIVATE_PATTERNS"
    fi

    [[ "$SKIP" == "true" ]] && continue

    # Check if already suggested, declined, or contributed
    if command -v node &>/dev/null; then
        STATUS=$(node -e "
            const fs = require('fs');
            const t = JSON.parse(fs.readFileSync('$TRACKER', 'utf8'));
            const f = '$filepath';
            if (t.declined && t.declined[f]) console.log('declined');
            else if (t.contributed && t.contributed[f]) console.log('contributed');
            else if (t.suggested && t.suggested[f]) console.log('suggested');
            else console.log('new');
        " 2>/dev/null) || STATUS="new"
    else
        STATUS="new"
    fi

    if [[ "$STATUS" == "new" ]]; then
        NEW_CHANGES+=("$filepath")
    fi
done <<< "$CHANGED_FILES"

# --- Nothing new to suggest ---
[[ ${#NEW_CHANGES[@]} -eq 0 ]] && exit 0

# --- Record new suggestions in tracker ---
TODAY=$(date +%Y-%m-%d)
if command -v node &>/dev/null; then
    CHANGES_JSON=$(printf '%s\n' "${NEW_CHANGES[@]}" | node -e "
        let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
            const files = d.trim().split('\n').filter(Boolean);
            const obj = {};
            files.forEach(f => obj[f] = '$TODAY');
            console.log(JSON.stringify(obj));
        });
    " 2>/dev/null) || CHANGES_JSON="{}"

    node -e "
        const fs = require('fs');
        const t = JSON.parse(fs.readFileSync('$TRACKER', 'utf8'));
        const newChanges = JSON.parse('$CHANGES_JSON');
        t.suggested = { ...t.suggested, ...newChanges };
        t.installed_version = '$INSTALLED_TAG';
        fs.writeFileSync('$TRACKER', JSON.stringify(t, null, 2));
    " 2>/dev/null || true
fi

# --- Output context for Claude session ---
CHANGE_LIST=$(printf '%s,' "${NEW_CHANGES[@]}")
CHANGE_LIST=${CHANGE_LIST%,}  # Remove trailing comma
echo "CONTRIBUTION_AVAILABLE: $CHANGE_LIST"

exit 0
