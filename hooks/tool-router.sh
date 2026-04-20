#!/bin/bash
# PreToolUse hook: tool router.
#
# Previously this hook blocked Claude.ai's native Gmail and Google Calendar MCP
# tools and redirected callers to "gws" CLI equivalents. The google-services
# marketplace bundle now provides real Gmail/Calendar skills built on gws, so
# the redirect-to-not-yet-built-gws shim is no longer needed and has been
# removed. See docs/superpowers/specs/2026-04-16-google-services-design.md.
#
# The hook is kept in place (empty pass-through) so that future tool-routing
# rules can be added here without re-wiring the hooks manifest.

# Source shared infrastructure (trap handlers, error capture, rotation)
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HOOK_DIR/lib/hook-preamble.sh" ]] && source "$HOOK_DIR/lib/hook-preamble.sh"

# Drain stdin (Claude Code always pipes JSON to PreToolUse hooks) so we don't
# leave a broken pipe for the caller.
cat >/dev/null

# No routes currently match — allow every tool call.
exit 0
