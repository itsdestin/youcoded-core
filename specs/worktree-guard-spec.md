# Worktree Guard — Spec

**Version:** 1.0
**Last updated:** 2026-03-23
**Feature location:** `core/hooks/worktree-guard.sh`
**Related spec:** `write-guard-spec.md`, `system-architecture-spec.md`

## Purpose

Prevents concurrent-session branch conflicts by blocking git branch switches in the main YouCoded plugin directory (`~/.claude/plugins/youcoded-core/`). The main plugin directory must stay on `master` at all times because multiple Claude Code sessions share it simultaneously. Feature work should use git worktrees instead.

## User Mandates

- (2026-03-23) Git branch operations (`checkout`, `switch`) in the main plugin directory MUST be blocked, with an instruction to use worktrees instead.
- (2026-03-23) Commit messages, echo text, heredocs, and other quoted strings MUST NOT trigger false positives — the hook must only match actual git commands, not prose about them.

## Design Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|----------------------|
| String-stripping before pattern matching | Removes single- and double-quoted strings from the command before checking for `git checkout`/`switch`. This prevents false positives when commit messages or echo statements contain branch-switching keywords. | Regex with negative lookahead (fragile with nested quotes), AST parsing (overkill for shell commands), no stripping (high false positive rate on commits with messages about branches). |
| Allowlist for `master`/`main` and file restores | Switching to `master`/`main` is always safe (returns to the expected state). `git checkout -- <file>` restores files without switching branches. Both are explicitly allowed. | Block everything including master (too restrictive — prevents recovery), prompt instead of block (too easy to accidentally confirm). |
| Block with worktree instructions | The block message includes a ready-to-use `git worktree add` command so the user can immediately create an isolated workspace. | Block with no guidance (frustrating), warn instead of block (too easy to ignore — mandate requires blocking). |
| `PLUGIN_DIR` constant | Hardcoded to `$HOME/.claude/plugins/youcoded-core` — the canonical plugin install location. The hook only activates for commands targeting this directory. | Config-file lookup (overhead on every Bash invocation), environment variable (not reliably set in hook context). |
| PreToolUse on Bash only | The hook fires on Bash tool invocations and checks whether the command targets the plugin directory. Other tools (Edit, Write) cannot switch branches. | Fire on all tools (unnecessary overhead), separate hook per git subcommand (fragile). |

## Implementation

### Hook Flow

1. **Parse stdin JSON** — extracts `tool_input.command` from the PreToolUse payload using node.
2. **Strip quoted strings** — removes all single- and double-quoted content via sed to eliminate false matches on commit messages, echo text, etc.
3. **Directory check** — only proceeds if the stripped command references `youcoded-core` or `plugins/youcoded-core`.
4. **Branch switch detection** — checks for `git checkout` or `git switch` in the stripped command.
5. **Allowlist check** — permits `master`/`main` checkout, file restores (`checkout --`), and returns silently.
6. **Block** — emits a JSON `{"decision":"block","reason":"..."}` with worktree instructions for any other branch operation.

### Registration

Registered as a PreToolUse hook for the Bash tool in `settings.json`. Symlinked from `core/hooks/worktree-guard.sh`.

## Known Issues & Planned Updates

See [GitHub Issues](https://github.com/itsdestin/youcoded-core/issues) for known issues and planned updates.
