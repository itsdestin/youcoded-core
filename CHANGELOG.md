# Changelog

All notable changes to ClaudifestDestiny will be documented in this file.

## v1.0.0 (2026-03-16)

Initial public release.

### Core
- Session hooks — git sync, statusline, write guard, title update, todo capture, checklist reminder, usage tracking
- Specs system for structured feature documentation with mandate/decision/implementation tiers
- Memory system templates for cross-session persistence
- Setup wizard with non-destructive installation, conflict resolution, and layer selection
- `/update` command with changelog display and safe merge-based updates
- `/contribute` command for forking, filtering private content, and creating upstream PRs
- `/toolkit-uninstall` command for clean removal with backup restoration
- Contribution detector — proactive SessionStart hook that suggests sharing improvements
- Statusline with toolkit version display and update notification

### Life
- Journaling assistant with Socratic-style conversational prompts
- Encyclopedia system — 8 modular source files with 4-level compilation (Full/Personal/Professional/Public)
- Encyclopedia interviewer for gap-filling interviews
- Encyclopedia librarian for reports, briefings, and deep search
- Google Drive sync via rclone

### Productivity
- Inbox processor for Todoist integration with active resolution
- Skill creator for building, testing, and benchmarking skills
- Google Messages MCP server for SMS/RCS through Claude

### Modules (Optional)
- Arizona Elections Notebook — legislative candidate and campaign finance tracking
- JLBC Fiscal Note Drafter — fiscal impact analysis in official format

### Documentation
- Beginner's guide (4 pages, zero jargon)
- Quickstart for existing Claude Code users
- System architecture deep dive
- Contributing guide
- Bootstrap scripts for macOS/Linux (bash) and Windows (PowerShell)
