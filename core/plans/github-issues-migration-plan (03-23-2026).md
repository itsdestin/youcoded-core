# GitHub Issues Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all planned updates and known issues out of individual spec files into GitHub Issues on `itsdestin/destinclaude`, making them community-accessible.

**Architecture:** Replace inline "Planned Updates" and "Known Bugs / Issues" sections in every spec with a single-line pointer to GitHub Issues. Set up issue templates and labels so community members can file bugs and feature requests. Update governance docs (specs-system-spec, system.md) to route future issues to GitHub instead of spec files.

**Tech Stack:** GitHub Issues, `gh` CLI, Markdown

---

## Context

### What's changing
- **Before:** Every spec has "Known Bugs / Issues" and "Planned Updates" sections with inline content. ~30 planned updates and 5 active bugs spread across 13 specs.
- **After:** Specs contain a single line: `See [GitHub Issues](https://github.com/itsdestin/destinclaude/issues) for planned updates and known issues.` All tracking happens on GitHub.

### Scope distinction
The **public plugin repo** (`itsdestin/destinclaude`) contains specs for public features. Some specs exist only in a **private repo** for personal features. This migration covers:
- **Public specs (in plugin):** Migrate items → GitHub Issues, replace sections with pointer
- **Private specs (not in plugin):** Keep their Planned Updates sections as-is (not relevant to community tracking)

### Items to migrate

**Important notes:**
- Some specs use "Known Issues" instead of "Known Bugs / Issues" — handle both variants.
- Where a Known Issue and Planned Update describe the same problem, file a single consolidated GitHub Issue.
- Resolved/fixed items (marked "(Fixed in vX.Y)" or "(resolved in vX.Y)") are historical and should NOT be migrated. They are removed along with the section.
- Change Log entries referencing the old section names are historical and must NOT be modified.

**Active Bugs:**
| # | Spec | Issue | Labels |
|---|------|-------|--------|
| 1 | Inbox Processor | `/todo` command not working | `bug`, `area:inbox` |
| 2 | Setup Wizard | iCloud restore (Phase 0 option 3) not yet implemented | `bug`, `area:setup` |
| 3 | Setup Wizard | Windows: symlink creation fails without Developer Mode | `bug`, `area:setup` |
| 4 | DestinClaude | No Linux desktop control MCP server equivalent | `bug`, `enhancement`, `area:core` |
| 5 | DestinClaude | `/contribute` command has no recovery path for non-technical users | `bug`, `area:core` |

**Planned Updates (Enhancements):**
| # | Spec | Item | Labels | Notes |
|---|------|------|--------|-------|
| 6 | Specs System | Title Case convention for UI text | `enhancement`, `area:specs` | |
| 7 | Specs System | "What do we need to improve?" utility | `enhancement`, `area:specs` | **Superseded** — close immediately |
| 8 | System Architecture | Layer 3 completion — slim CLAUDE.md to ~2KB | `enhancement`, `area:core` | |
| 9 | System Architecture | Test infrastructure — `tests/` with bash integration tests | `enhancement`, `area:core` | |
| 10 | System Architecture | Automated restore script | `enhancement`, `area:core` | |
| 11 | Backup & Sync | Full snapshot time estimate with rolling averages | `enhancement`, `area:core` | |
| 12 | Encyclopedia System | Monthly review sequencing | `enhancement`, `area:encyclopedia` | |
| 13 | Encyclopedia System | Interview metadata schema | `enhancement`, `area:encyclopedia` | |
| 14 | Encyclopedia System | Deep Search approval unification | `enhancement`, `area:encyclopedia` | |
| 15 | Encyclopedia System | Todoist integration failure contract | `enhancement`, `area:encyclopedia` | |
| 16 | Encyclopedia System | Contact info tracking in People Database | `enhancement`, `area:encyclopedia` | |
| 17 | Encyclopedia Librarian | Audience-aware filtering for sensitive content | `enhancement`, `area:encyclopedia` | |
| 18 | Inbox Processor | Better rant/mini journal processing | `enhancement`, `area:inbox` | |
| 19 | Inbox Processor | Formalize response format | `enhancement`, `area:inbox` | |
| 20 | Statusline | Session cost display | `enhancement`, `area:core` | |
| 21 | Statusline | Configurable throttle interval | `enhancement`, `area:core` | |
| 22 | Landing Page | Self-host integration icons as local SVGs | `enhancement`, `area:core` | |
| 23 | Landing Page | OG image for social sharing previews | `enhancement`, `area:core` | |
| 24 | Landing Page | Promote mockup to live | `enhancement`, `area:core` | |
| 25 | Setup Wizard | iCloud restore path implementation | `enhancement`, `area:setup` | Consolidate with bug #2 |
| 26 | Setup Wizard | Module discovery and selection UI | `enhancement`, `area:setup` | |
| 27 | Setup Wizard | Incremental re-run detection | `enhancement`, `area:setup` | |
| 28 | DestinClaude | Extract messaging setup into standalone post-setup flow | `enhancement`, `area:setup` | |
| 29 | DestinClaude | Add difficulty options for setup wizard | `enhancement`, `area:setup` | |
| 30 | DestinClaude | Add clearer skill/workflow creation guidance | `enhancement`, `area:setup` | Partially resolved |
| 31 | DestinClaude | Add more DestinTip prompts for first-run | `enhancement`, `area:core` | |
| 32 | DestinClaude | Add iCloud support via rclone as Drive alternative | `enhancement`, `area:core` | |
| 33 | DestinClaude | Desktop App Phase 2 (Electron GUI) | `enhancement`, `area:core` | |

**After deduplication:** Items #2 and #25 (iCloud restore) should be filed as a single issue labeled both `bug` and `enhancement`. Total unique issues: **32** (31 open + 1 closed).

**Private-only specs** were reviewed separately and are not tracked in this public repository.

---

## File Map

### Files to create (plugin repo)
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Structured bug report template
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request template
- `.github/ISSUE_TEMPLATE/config.yml` — Template chooser config

### Files to modify (plugin repo — replace Known Bugs/Issues + Planned Updates sections with pointer)

**Specs with active content to migrate (read carefully before editing):**
- `core/specs/destinclaude-spec.md` — uses "Known Issues" header (not "Known Bugs / Issues"); has both active and resolved items
- `core/specs/specs-system-spec.md`
- `core/specs/system-architecture-spec.md`
- `core/specs/backup-system-spec.md`
- `core/specs/statusline-spec.md` — has resolved bugs (historical) + active planned updates
- `core/specs/landing-page-spec.md` — has Planned Updates only (no bugs section)
- `life/skills/encyclopedia-update/specs/encyclopedia-system-spec.md` — this is the actual path (NOT core/specs/)
- `life/skills/encyclopedia-librarian/specs/encyclopedia-librarian-spec.md`
- `productivity/skills/inbox-processor/specs/inbox-processor-spec.md`
- `core/skills/setup-wizard/specs/setup-wizard-spec.md`

**Specs with empty sections (replace with pointer — straightforward):**
- `core/specs/write-guard-spec.md`
- `core/specs/memory-system-spec.md`
- `core/specs/personal-sync-spec.md`
- `life/skills/encyclopedia-compile/specs/encyclopedia-compile-spec.md`
- `life/skills/encyclopedia-update/specs/encyclopedia-update-spec.md`
- `life/skills/encyclopedia-interviewer/specs/encyclopedia-interviewer-spec.md`
- `life/skills/journaling-assistant/specs/journaling-assistant-spec.md`
- `life/skills/google-drive/specs/google-drive-spec.md`
- `productivity/skills/skill-creator/specs/skill-creator-spec.md`

**Specs without Known Bugs or Planned Updates sections (ADD the pointer section):**
- `core/specs/destintip-spec.md` — add section before Change Log
- `life/skills/fork-file/specs/fork-file-spec.md` — add section before Change Log

**Other files:**
- `docs/contributing.md` — Add "Filing Issues" section

### Files to modify (private repo — governance updates)
- `~/.claude/specs/specs-system-spec.md` — Update mandate about Planned Updates
- `~/.claude/docs/system.md` — Update System Change Checklist
- All private-repo spec files that have public counterparts (mirror the section replacement)

### Files to modify (plugin repo — governance updates)
- `core/specs/specs-system-spec.md` — Update mandate about Planned Updates (plugin copy)

---

## Tasks

### Task 1: Create GitHub Issue Labels

**Files:**
- None (GitHub API only)

- [ ] **Step 1: Create labels via `gh` CLI**

```bash
cd ~/.claude/plugins/destinclaude

# Type labels
gh label create "bug" --description "Something isn't working" --color "d73a4a" --force
gh label create "enhancement" --description "New feature or improvement" --color "a2eeef" --force
gh label create "good first issue" --description "Good for newcomers" --color "7057ff" --force

# Area labels (match plugin layers + key systems)
gh label create "area:core" --description "Core layer: hooks, backup, statusline, write-guard, memory" --color "0075ca"
gh label create "area:encyclopedia" --description "Encyclopedia system and related skills" --color "008672"
gh label create "area:journaling" --description "Journaling assistant" --color "e4e669"
gh label create "area:inbox" --description "Inbox processor and task management" --color "d876e3"
gh label create "area:setup" --description "Setup wizard, installation, onboarding" --color "f9d0c4"
gh label create "area:specs" --description "Specs system and governance" --color "c5def5"
```

- [ ] **Step 2: Verify labels exist**

```bash
gh label list --repo itsdestin/destinclaude
```

Expected: All 9 labels visible.

- [ ] **Step 3: Commit** — No file changes; labels are GitHub-only.

---

### Task 2: Create Issue Templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

- [ ] **Step 1: Create bug report template**

```yaml
# .github/ISSUE_TEMPLATE/bug_report.yml
name: Bug Report
description: Report a bug or unexpected behavior
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting! Please fill out as much as you can.
  - type: input
    id: version
    attributes:
      label: DestinClaude Version
      description: Run `/toolkit` or check your VERSION file
      placeholder: "e.g., 1.3.1"
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Area
      description: Which part of the toolkit is affected?
      options:
        - Core (hooks, backup, statusline, memory)
        - Encyclopedia
        - Journaling
        - Inbox Processor
        - Setup / Installation
        - Specs System
        - Other
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: What happened?
      description: Describe the bug clearly
      placeholder: "When I run X, I expect Y but get Z instead."
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      description: How can someone else trigger this?
      placeholder: |
        1. Run `/setup-wizard`
        2. Select option X
        3. See error
  - type: textarea
    id: context
    attributes:
      label: Additional context
      description: Logs, screenshots, OS, shell, etc.
```

- [ ] **Step 2: Create feature request template**

```yaml
# .github/ISSUE_TEMPLATE/feature_request.yml
name: Feature Request
description: Suggest a new feature or improvement
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Have an idea to make DestinClaude better? We'd love to hear it.
  - type: dropdown
    id: area
    attributes:
      label: Area
      description: Which part of the toolkit would this affect?
      options:
        - Core (hooks, backup, statusline, memory)
        - Encyclopedia
        - Journaling
        - Inbox Processor
        - Setup / Installation
        - Specs System
        - New Skill / Module
        - Other
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: What would you like?
      description: Describe the feature or improvement
    validations:
      required: true
  - type: textarea
    id: motivation
    attributes:
      label: Why?
      description: What problem does this solve or what workflow does it improve?
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: Have you tried other approaches or workarounds?
```

- [ ] **Step 3: Create template chooser config**

```yaml
# .github/ISSUE_TEMPLATE/config.yml
blank_issues_enabled: true
```

- [ ] **Step 4: Commit**

```bash
cd ~/.claude/plugins/destinclaude
git add .github/ISSUE_TEMPLATE/
git commit -m "feat: add GitHub Issue templates for bug reports and feature requests"
```

---

### Task 3: File Migrated Issues

**Files:**
- None (GitHub API only)

Create one GitHub Issue per migrated item. Use `gh issue create` with appropriate labels and body text preserving the original context from the spec.

- [ ] **Step 1: File all issues from migration table**

For each item in the "Items to migrate" tables above, run:

```bash
gh issue create --repo itsdestin/destinclaude \
  --title "<title>" \
  --label "<comma-separated labels from table>" \
  --body "$(cat <<'EOF'
## Context

<original context from spec section — preserve full description>

---

*Migrated from `<spec-name>` spec.*
EOF
)"
```

**Deduplication:** Items #2 and #25 (iCloud restore) should be a single issue combining the bug report and enhancement description.

**Superseded:** Item #7 ("What do we need to improve?" utility) should be created and immediately closed:
```bash
gh issue close <number> --comment "Superseded by this GitHub Issues migration — GitHub Issues is now the aggregated view of all planned work."
```

- [ ] **Step 2: Verify all issues exist**

```bash
gh issue list --repo itsdestin/destinclaude --state all --limit 40
```

Expected: 31 issues (30 open + 1 closed).

---

### Task 4: Update Spec Files (Plugin Repo)

**Files:**
- All spec files listed in the File Map above

For every spec file in the plugin repo, replace both the "Known Bugs / Issues" (or "Known Issues") section and "Planned Updates" section with:

```markdown
## Known Issues & Planned Updates

See [GitHub Issues](https://github.com/itsdestin/destinclaude/issues) for known issues and planned updates.
```

This consolidates the two sections into one line. The Change Log section remains untouched.

**Handling notes:**
- Some specs use "Known Issues" instead of "Known Bugs / Issues" (e.g., `destinclaude-spec.md`). Handle both variants.
- Some specs have only one of the two sections (e.g., `landing-page-spec.md` has Planned Updates but no Known Bugs). Replace whatever exists.
- Specs without either section (`destintip-spec.md`, `fork-file-spec.md`) need the pointer section **added** before the Change Log.
- Resolved/fixed items within sections are removed along with the section. They are historical and don't need preservation. Change Log entries referencing old section names are historical and must NOT be modified.
- If a section has a design decision referencing "Planned Updates" as a routing target (e.g., `inbox-processor-spec.md`), update that text to reference GitHub Issues.

**Partial failure recovery:** If this task fails midway, run the grep verification (Step 2) to identify which specs still need conversion. GitHub Issues are idempotent — duplicates can be closed.

- [ ] **Step 1: Update all plugin repo specs**

Work through each file from the File Map. Read each one first, then replace precisely. The "specs with active content" group needs the most care.

- [ ] **Step 2: Verify no orphaned sections remain**

```bash
cd ~/.claude/plugins/destinclaude
grep -rn "## Planned Updates" --include="*-spec.md" .
grep -rn "## Known Bugs" --include="*-spec.md" .
grep -rn "## Known Issues$" --include="*-spec.md" .
```

Expected: No matches. The only tracking header should be "## Known Issues & Planned Updates".

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/plugins/destinclaude
git add core/specs/*-spec.md life/skills/*/specs/*-spec.md productivity/skills/*/specs/*-spec.md core/skills/*/specs/*-spec.md
git commit -m "refactor: replace spec Planned Updates/Known Bugs with GitHub Issues pointer

All planned updates and known issues have been migrated to GitHub Issues.
Each spec now points to the issue tracker instead of maintaining inline lists."
```

---

### Task 5: Update Private Repo Specs

**System specs (in `~/.claude/specs/`):**
- `~/.claude/specs/specs-system-spec.md`
- `~/.claude/specs/system-architecture-spec.md`
- `~/.claude/specs/backup-system-spec.md`
- `~/.claude/specs/write-guard-spec.md`
- `~/.claude/specs/memory-system-spec.md`
- `~/.claude/specs/statusline-spec.md`
- `~/.claude/specs/encyclopedia-system-spec.md`

**Skill specs with public counterparts (in `~/.claude/skills/{name}/specs/`):**
- `~/.claude/skills/encyclopedia-compile/specs/encyclopedia-compile-spec.md`
- `~/.claude/skills/encyclopedia-update/specs/encyclopedia-update-spec.md`
- `~/.claude/skills/encyclopedia-interviewer/specs/encyclopedia-interviewer-spec.md`
- `~/.claude/skills/encyclopedia-librarian/specs/encyclopedia-librarian-spec.md`
- `~/.claude/skills/journaling-assistant/specs/journaling-assistant-spec.md`
- `~/.claude/skills/google-drive/specs/google-drive-spec.md`
- `~/.claude/skills/inbox-processor/specs/inbox-processor-spec.md`
- `~/.claude/skills/skill-creator/specs/skill-creator-spec.md`

**Do NOT touch private-only specs** (those in the private repo). These keep their inline Planned Updates sections.

- [ ] **Step 1: Apply same replacement as Task 4 to all listed private specs**

Same pattern: replace "Known Bugs / Issues" and "Planned Updates" with the consolidated GitHub Issues pointer.

- [ ] **Step 2: Verify private-only specs still have their sections intact**

```bash
grep -l "Planned Updates" ~/.claude/specs/*-spec.md ~/.claude/skills/*/specs/*-spec.md | grep -v "destinclaude/"
```

Expected: All 5 files still have their Planned Updates content.

---

### Task 6: Update Governance Documents

**Files:**
- Modify: `~/.claude/specs/specs-system-spec.md` — mandate and design decision changes
- Modify: `~/.claude/plugins/destinclaude/core/specs/specs-system-spec.md` — same (plugin copy)
- Modify: `~/.claude/docs/system.md` — checklist update

- [ ] **Step 1: Update specs-system-spec.md mandate**

In the User Mandates section, replace the mandate:
> Every spec must include a "Planned Updates" section for logging future improvement ideas with brief context. (2026-03-14)

With:
> Every spec must include a "Known Issues & Planned Updates" section with a pointer to GitHub Issues (`https://github.com/itsdestin/destinclaude/issues`). New bugs and feature ideas are filed as GitHub Issues, not tracked inline in specs. Private-only specs (not in the public plugin repo) may optionally keep inline Planned Updates sections. (2026-03-23)

- [ ] **Step 2: Update specs-system-spec.md Design Decisions table**

Replace the "Planned Updates section in every spec" row with:

| GitHub Issues for tracking bugs and planned updates | Centralizes tracking in one community-accessible location. Eliminates drift between spec sections and actual priorities. External users can file bugs and request features. Private-only specs retain inline sections for non-public work. | Inline spec sections (previous approach — worked solo but couldn't accept community input), separate BACKLOG.md (rejected: still requires PRs to contribute), Linear/Jira (rejected: external dependency, requires separate accounts) |

- [ ] **Step 3: Update specs-system-spec.md template description**

In the "Spec template structure" paragraph, update to reflect that specs now have "Known Issues & Planned Updates" (a pointer section) instead of separate "Known Bugs / Issues" and "Planned Updates" content sections.

- [ ] **Step 4: Update specs-system-spec.md Change Log**

Add entry:
| 2026-03-23 | 3.0 | Migrated Planned Updates and Known Bugs tracking to GitHub Issues. Specs now contain a pointer section instead of inline content. Updated mandate, design decision, and template description. | Architecture | Destin | |

Note: This is a **major version bump** (2.4 → 3.0) because it's an architectural change to how issues are tracked.

- [ ] **Step 5: Update system.md System Change Checklist**

Add a new checklist item after the specs/INDEX.md item:
> - GitHub Issues — file a GitHub Issue if the change reveals a bug or creates a planned follow-up

- [ ] **Step 6: Mirror governance changes to plugin repo copy of specs-system-spec.md**

- [ ] **Step 7: Commit both repos**

Plugin repo:
```bash
cd ~/.claude/plugins/destinclaude
git add core/specs/specs-system-spec.md
git commit -m "docs: update specs-system-spec for GitHub Issues migration (v3.0)"
```

Private repo commits happen automatically via git-sync hook.

---

### Task 7: Update Contributing Guide

**Files:**
- Modify: `~/.claude/plugins/destinclaude/docs/contributing.md`

- [ ] **Step 1: Add "Filing Issues" section near the top of contributing.md**

Add before the existing contribution workflow section:

```markdown
## Filing Issues

Found a bug or have a feature idea? [Open a GitHub Issue](https://github.com/itsdestin/destinclaude/issues/new/choose).

- **Bug reports** — Use the bug report template. Include your DestinClaude version and steps to reproduce.
- **Feature requests** — Use the feature request template. Describe what you'd like and why.

You don't need to know which spec a bug relates to — just describe the problem and we'll triage it.
```

- [ ] **Step 2: Commit**

```bash
cd ~/.claude/plugins/destinclaude
git add docs/contributing.md
git commit -m "docs: add Filing Issues section to contributing guide"
```

---

### Task 8: Update README (if needed)

**Files:**
- Modify: `~/.claude/plugins/destinclaude/README.md`

- [ ] **Step 1: Check if README mentions issue filing or contribution**

Read the README and determine if a link to GitHub Issues should be added (e.g., in a "Contributing" or "Feedback" section).

- [ ] **Step 2: Add Issues link if appropriate**

If there's a contributing section, add: `Report bugs or request features via [GitHub Issues](https://github.com/itsdestin/destinclaude/issues).`

- [ ] **Step 3: Commit if changed**

---

### Task 9: Update Specs Index

**Files:**
- Modify: `~/.claude/specs/INDEX.md`
- Modify: `~/.claude/plugins/destinclaude/core/specs/INDEX.md`

- [ ] **Step 1: Update version for specs-system-spec in INDEX.md**

Change version from 2.4 to 3.0 in both copies.

- [ ] **Step 2: Commit plugin repo changes**

---

### Task 10: Final Verification

- [ ] **Step 1: Verify no stale references to old pattern**

```bash
# In plugin repo — search for old section headers
cd ~/.claude/plugins/destinclaude
grep -rn "## Planned Updates" --include="*-spec.md" .
grep -rn "## Known Bugs" --include="*-spec.md" .
grep -rn "## Known Issues$" --include="*-spec.md" .

# In private repo — only private-only specs should still have content
grep -rn "## Planned Updates" ~/.claude/specs/ | grep -v "private-only specs"
```

Expected: No matches in the plugin repo. No matches in private repo (the private-only specs are excluded from the grep).

- [ ] **Step 2: Verify GitHub Issues are accessible**

```bash
gh issue list --repo itsdestin/destinclaude --state all --limit 20
```

- [ ] **Step 3: Verify issue templates work**

```bash
gh api repos/itsdestin/destinclaude/contents/.github/ISSUE_TEMPLATE --jq '.[].name'
```

Expected: `bug_report.yml`, `config.yml`, `feature_request.yml`

- [ ] **Step 4: Run System Change Checklist** (per `~/.claude/docs/system.md`)

Evaluate each item:
- [x] CLAUDE.md — No update needed (doesn't reference spec issue sections directly)
- [x] .gitignore — No update needed
- [x] git-sync.sh — No update needed
- [x] backup-system-spec.md — No update needed (only the pointer section changes)
- [x] README.md — Checked in Task 8
- [x] RESTORE.md — No update needed
- [x] restore.sh — No update needed
- [x] Memory — No update needed
- [x] specs/INDEX.md — Updated in Task 9
- [x] Grep for stale references — Done in Step 1
