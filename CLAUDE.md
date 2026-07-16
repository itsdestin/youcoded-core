# CLAUDE.md

youcoded-core is a bundled Claude Code plugin for the YouCoded app — **actively being deprecated** (write-guard moves into the app natively; this repo will be archived). Prefer fixing bugs over adding features; new functionality belongs in the app or a marketplace plugin.

## Workspace conventions (read this if you opened this repo standalone)

This repo is one component of the YouCoded product. Development is coordinated from the **youcoded-dev workspace repo**: https://github.com/itsdestin/youcoded-dev — if it isn't on this machine, clone it and run `bash setup.sh` (it clones every sub-repo and carries the working rules, path-scoped rules, and cross-repo docs, including the deprecation plan at `docs/active/plans/2026-04-21-deprecate-youcoded-core.md`).

- **Lifecycle documents** (specs, plans, handoffs, investigations) do NOT live in this repo — they go to the workspace: `youcoded-dev/docs/active/` (in flight) → `youcoded-dev/docs/archive/` (done).
- **Planning** happens in the workspace `ROADMAP.md` — one roadmap for the whole product.
- Repo-specific invariants (hooks-manifest reconciliation, `.sh` execute bits, release auto-tag flow) live in the workspace rule `youcoded-dev/.claude/rules/youcoded-toolkit.md` + `youcoded-dev/docs/toolkit-structure.md`.
