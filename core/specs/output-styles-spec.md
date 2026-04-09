---
name: Output Styles
version: 1.0
last_updated: 2026-04-08
status: active
---

# Output Styles — Spec

**Feature location:** `output-styles/` (conversational-style, academic-style, professional-style)

## Purpose

Custom output style plugins that reposition Claude Code as a general-purpose assistant for non-coders. These mirror the structure of Anthropic's official output styles (Explanatory, Learning) but explicitly tell Claude it is NOT serving in a coding capacity.

## Motivation

Claude Code's default system prompt is optimized for software engineering. But many users — students, professionals, and anyone with a Claude Pro/Max plan — use Claude Code as their primary Claude interface, not just for coding. These styles let them opt into a mode that matches how they actually use it.

## Styles

| Style | Target User | Personality |
|-------|-------------|-------------|
| **Conversational** | Anyone wanting a general chatbot | Warm, natural, like claude.ai — no code assumptions |
| **Academic** | Students and researchers | Rigorous, citation-aware, Socratic, uses `--- Key Concept ---` blocks |
| **Professional** | Working professionals | Polished, structured, leads with recommendations, uses `>>> Recommendation ---` blocks |

## Design Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|----------------------|
| SessionStart hook (not markdown output-style files) | Mirrors official Anthropic styles exactly; plugin-distributable; works with existing enable/disable mechanism | Markdown files in `~/.claude/output-styles/` (rejected: can't distribute via plugin, different mechanism than official styles) |
| Explicit "NOT a software engineering tool" language | The `additionalContext` approach adds instructions but doesn't remove the default coding system prompt — override must be strong and clear | Subtle hints (rejected: base prompt is strongly code-oriented, subtle doesn't work) |
| Each style has a signature callout block format | Gives each style a distinct visual identity, mirrors `★ Insight` from Explanatory | No formatting convention (rejected: styles feel generic without a visual signature) |
| Tools remain available but not reflexive | Users may still want file I/O, web search, etc. — just not as the default response to every prompt | Disable tools entirely (rejected: too restrictive, removes real value) |

## User Mandates

- (2026-04-08) Output styles must use the Claude Code plugin format (`.claude-plugin/plugin.json` + `hooks/hooks.json`), not the DestinClaude skill format. They are standalone plugins users can enable/disable independently.
- (2026-04-08) Each style must include explicit "NOT a software engineering tool" language. The base Claude Code system prompt is strongly code-oriented — subtle hints don't override it.
- (2026-04-08) Tools (file I/O, bash, web search) must remain available. The styles reposition Claude's default behavior, they don't remove capabilities.

## Current Implementation

Each style is a standalone Claude Code plugin at `output-styles/{style-name}/`:

```
output-styles/{style-name}/
  .claude-plugin/plugin.json     # Plugin metadata (name, version, author)
  hooks/hooks.json               # Declares a SessionStart hook
  hooks-handlers/session-start.sh  # Emits additionalContext JSON
```

The `session-start.sh` script outputs a JSON object with `hookSpecificOutput.additionalContext` containing the full style instructions. Claude Code injects this into the session as additional context alongside the default system prompt.

## Dependencies

- Claude Code plugin system (`.claude-plugin/` format with `hooks/hooks.json`)
- Bash (for `session-start.sh` hook handlers)

## Known Issues & Planned Updates

- Distribution path not yet established — plugins need marketplace entries and/or plugins-manifest.json registration for automatic discovery
- See [GitHub Issues](https://github.com/itsdestin/destinclaude/issues) for open items

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-08 | Initial spec — 3 styles (conversational, academic, professional) |
