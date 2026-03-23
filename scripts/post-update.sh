#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# post-update.sh — Post-merge hook dispatcher for destinclaude toolkit
#
# Runs after git merge (via .git/hooks/post-merge) to perform tasks that the
# /update skill cannot handle because the skill is loaded before the merge.
# This script is read at execution time (new version) so it knows about newly
# added hooks and phases.
# =============================================================================

# --- Constants ----------------------------------------------------------------

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
CONFIG_FILE="$CLAUDE_HOME/toolkit-state/config.json"

# Resolve SCRIPT_DIR to the absolute directory containing this script.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Trap handler -------------------------------------------------------------

_trap_handler() {
  local exit_code=$?
  local line_no="${1:-}"
  emit "FAIL" "script" "unexpected error: exit ${exit_code} at line ${line_no}"
  exit 2
}
trap '_trap_handler $LINENO' ERR

# =============================================================================
# Platform detection
# =============================================================================

PLATFORM=""

detect_platform() {
  local uname_out
  uname_out="$(uname -s 2>/dev/null || true)"

  case "$uname_out" in
    Darwin*)
      PLATFORM="macos"
      ;;
    Linux*)
      PLATFORM="linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PLATFORM="windows"
      export MSYS=winsymlinks:nativestrict
      ;;
    *)
      # Fallback: check OSTYPE
      case "${OSTYPE:-}" in
        darwin*)  PLATFORM="macos"   ;;
        linux*)   PLATFORM="linux"   ;;
        msys*|cygwin*|win*) PLATFORM="windows"; export MSYS=winsymlinks:nativestrict ;;
        *)        PLATFORM="unknown" ;;
      esac
      ;;
  esac
}

# =============================================================================
# Path helpers
# =============================================================================

# to_node_path PATH
# On Windows/MSYS, converts /c/Users/... style paths to C:/Users/... so Node.js
# (which does not understand MSYS drive paths) can open them.  On other platforms
# the path is returned unchanged.
to_node_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$p"
  else
    printf '%s' "$p"
  fi
}

# =============================================================================
# JSON helpers
# =============================================================================

# json_read FILE KEY
# Reads a single string value from a JSON file using node.
json_read() {
  local file="$1"
  local key="$2"
  local node_file
  node_file="$(to_node_path "$file")"
  node -e "
    try {
      var d = require('fs').readFileSync('${node_file}', 'utf8');
      var obj = JSON.parse(d);
      var val = obj['${key}'];
      if (val === undefined || val === null) { process.stderr.write('key not found: ${key}\n'); process.exit(1); }
      process.stdout.write(String(val));
    } catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
  "
}

# json_read_array FILE KEY
# Reads a JSON array from a JSON file and prints each element on its own line.
json_read_array() {
  local file="$1"
  local key="$2"
  local node_file
  node_file="$(to_node_path "$file")"
  node -e "
    try {
      var d = require('fs').readFileSync('${node_file}', 'utf8');
      var obj = JSON.parse(d);
      var arr = obj['${key}'];
      if (!Array.isArray(arr)) { process.stderr.write('key is not an array: ${key}\n'); process.exit(1); }
      arr.forEach(function(item) { process.stdout.write(String(item) + '\n'); });
    } catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
  "
}

# =============================================================================
# Config loading
# =============================================================================

TOOLKIT_ROOT=""
INSTALLED_LAYERS=()

load_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    emit "FAIL" "config" "config file not found: $CONFIG_FILE"
    exit 1
  fi

  TOOLKIT_ROOT="$(json_read "$CONFIG_FILE" "toolkit_root")"

  # Read installed_layers array into a bash indexed array.
  # Uses a while-read loop for bash 3.2 compatibility (no mapfile/readarray).
  INSTALLED_LAYERS=()
  while IFS= read -r line; do
    [ -n "$line" ] && INSTALLED_LAYERS+=("$line")
  done < <(json_read_array "$CONFIG_FILE" "installed_layers")
}

# =============================================================================
# Toolkit root discovery
# =============================================================================

# discover_toolkit_root — derive toolkit root from script location.
# scripts/post-update.sh lives one level below the toolkit root.
discover_toolkit_root() {
  cd "$SCRIPT_DIR/.." && pwd
}

# =============================================================================
# Output helpers
# =============================================================================

# emit STATUS ITEM MESSAGE
# Prints: [STATUS] item — message
emit() {
  local status="$1"
  local item="$2"
  local message="$3"
  printf '[%s] %s \xe2\x80\x94 %s\n' "$status" "$item" "$message"
}

# emit_section NAME
# Prints: === NAME ===
emit_section() {
  local name="$1"
  printf '=== %s ===\n' "$name"
}

# emit_summary TEXT
# Prints: [INFO] TEXT
emit_summary() {
  local text="$1"
  printf '[INFO] %s\n' "$text"
}

# =============================================================================
# Phases
# =============================================================================

phase_self_check() {
  emit_section "Self-Check"

  local checks_passed=0
  local checks_failed=0

  # ---- 1. node available -------------------------------------------------------
  local node_ver
  if node_ver="$(node --version 2>/dev/null)"; then
    emit "OK" "node" "found (${node_ver})"
    checks_passed=$((checks_passed + 1))
  else
    emit "FAIL" "node" "not found — node is required"
    checks_failed=$((checks_failed + 1))
  fi

  # ---- 2. config.json exists and is parseable ----------------------------------
  local config_ok=0
  if [ ! -f "$CONFIG_FILE" ]; then
    emit "FAIL" "config.json" "not found: $CONFIG_FILE"
    checks_failed=$((checks_failed + 1))
  else
    local node_config
    node_config="$(to_node_path "$CONFIG_FILE")"
    if node -e "JSON.parse(require('fs').readFileSync('${node_config}','utf8'))" 2>/dev/null; then
      emit "OK" "config.json" "valid"
      checks_passed=$((checks_passed + 1))
      config_ok=1
    else
      emit "FAIL" "config.json" "invalid JSON: $CONFIG_FILE"
      checks_failed=$((checks_failed + 1))
    fi
  fi

  # ---- 3 & 4. toolkit_root exists and contains VERSION; stale check -----------
  if [ "$config_ok" -eq 1 ]; then
    local cfg_toolkit_root
    if cfg_toolkit_root="$(json_read "$CONFIG_FILE" "toolkit_root" 2>/dev/null)"; then
      if [ -d "$cfg_toolkit_root" ] && [ -f "$cfg_toolkit_root/VERSION" ]; then
        emit "OK" "toolkit_root" "$cfg_toolkit_root"
        checks_passed=$((checks_passed + 1))
      else
        # Directory missing or no VERSION — compare with discovered root
        local discovered
        discovered="$(discover_toolkit_root)"
        if [ "$cfg_toolkit_root" != "$discovered" ]; then
          emit "FAIL" "toolkit_root" "stale: config has '$cfg_toolkit_root', script suggests '$discovered'"
        else
          emit "FAIL" "toolkit_root" "missing or incomplete: $cfg_toolkit_root (no VERSION file)"
        fi
        checks_failed=$((checks_failed + 1))
      fi
    else
      emit "FAIL" "toolkit_root" "key not found in config"
      checks_failed=$((checks_failed + 1))
    fi

    # ---- 5. installed_layers is non-empty --------------------------------------
    local layers=""
    local layer_count=0
    while IFS= read -r line; do
      if [ -n "$line" ]; then
        layer_count=$((layer_count + 1))
        if [ -z "$layers" ]; then
          layers="$line"
        else
          layers="${layers}, ${line}"
        fi
      fi
    done < <(json_read_array "$CONFIG_FILE" "installed_layers" 2>/dev/null || true)

    if [ "$layer_count" -gt 0 ]; then
      emit "OK" "installed_layers" "$layers"
      checks_passed=$((checks_passed + 1))
    else
      emit "FAIL" "installed_layers" "empty or missing — at least one layer required"
      checks_failed=$((checks_failed + 1))
    fi
  fi

  # ---- 6. Windows symlink creation test ----------------------------------------
  if [ "$PLATFORM" = "windows" ]; then
    local tmp_target tmp_link
    tmp_target="$(mktemp)"
    tmp_link="${tmp_target}.symlink"

    if ln -s "$tmp_target" "$tmp_link" 2>/dev/null && [ -L "$tmp_link" ]; then
      emit "OK" "symlinks" "creation test passed (windows)"
      checks_passed=$((checks_passed + 1))
    else
      emit "FAIL" "symlinks" "cannot create (Developer Mode may be disabled)"
      checks_failed=$((checks_failed + 1))
    fi
    rm -f "$tmp_target" "$tmp_link"
  fi

  # ---- Summary -----------------------------------------------------------------
  emit_summary "${checks_passed} checks passed, ${checks_failed} failed"

  if [ "$checks_failed" -gt 0 ]; then
    exit 1
  fi
}

phase_refresh() {
  emit_summary "refresh: not yet implemented"
}

phase_orphans() {
  emit_summary "orphans: not yet implemented"
}

phase_remove_orphan() {
  local target="${1:-}"
  emit_summary "remove-orphan (${target}): not yet implemented"
}

phase_verify() {
  emit_summary "verify: not yet implemented"
}

phase_mcps() {
  emit_summary "mcps: not yet implemented"
}

phase_plugins() {
  emit_summary "plugins: not yet implemented"
}

phase_migrations() {
  local from_ver="${1:-}"
  local to_ver="${2:-}"
  emit_summary "migrations (${from_ver} -> ${to_ver}): not yet implemented"
}

phase_post_update() {
  emit_summary "post-update: not yet implemented"
}

# =============================================================================
# Main dispatcher
# =============================================================================

main() {
  detect_platform

  local phase="${1:-}"

  # self-check validates config itself; all other phases need config loaded first
  if [ "$phase" != "self-check" ]; then
    load_config
  fi

  case "$phase" in
    self-check)
      phase_self_check
      ;;
    refresh)
      phase_refresh
      ;;
    orphans)
      phase_orphans
      ;;
    remove-orphan)
      phase_remove_orphan "${2:-}"
      ;;
    verify)
      phase_verify
      ;;
    mcps)
      phase_mcps
      ;;
    plugins)
      phase_plugins
      ;;
    migrations)
      phase_migrations "${2:-}" "${3:-}"
      ;;
    post-update)
      phase_post_update
      ;;
    *)
      emit "FAIL" "unknown phase: ${1:-}" "use: self-check|refresh|orphans|remove-orphan|verify|mcps|plugins|migrations|post-update"
      exit 2
      ;;
  esac
}

main "$@"
