---
description: Show all ClaudifestDestiny features, commands, skills, and useful phrases
---

Show the user a complete reference of everything the toolkit provides. Read the toolkit config at `~/.claude/toolkit-state/config.json` to determine which layers are installed, then present only the relevant features.

## Output Format

Present this as a clean, scannable reference card. Use the installed layers from the config to determine which sections to show.

```
ClaudifestDestiny Toolkit — Quick Reference

COMMANDS (type these in Claude)
  /setup ................ Run or re-run the setup wizard
  /update ............... Check for and install toolkit updates
  /toolkit .............. Show this reference card
  /toolkit-uninstall .... Remove the toolkit and restore your previous setup

SKILLS (activated by name or by saying certain phrases)

  Core:
    setup-wizard ........ "set me up" / /setup

  Life: (if installed)
    journaling .......... "let's journal" / "daily journal" / "let's catch up"
    encyclopedia ........ "update my encyclopedia" / "compile the encyclopedia"
    interviewer ......... "interview me" / "fill gaps in my encyclopedia"
    librarian ........... "brief me on [person]" / "deep search [topic]"
                          "pull together everything about [topic]"
    google-drive ........ "sync to drive" / "upload to drive"

  Productivity: (if installed)
    inbox-processor ..... "check my inbox" / "process my notes"
    skill-creator ....... "create a skill" / "build a new skill"

  Modules: (if installed)
    elections-notebook .. "update the elections notebook" / "pull candidate data"
    jlbc-fiscal-note .... "draft a fiscal note" / "fiscal impact for [bill]"

HOOKS (run automatically — you don't need to do anything)
    git-sync ............ Backs up your config after every file change
    session-start ....... Syncs encyclopedia + checks inbox on startup
    write-guard ......... Prevents file conflicts between sessions
    statusline .......... Shows model, context %, sync status at bottom of screen
    checklist-reminder .. Reminds about system changes at session end

WHAT TO SAY
  Here are useful phrases to get started:

    "Let's journal"
      Start a daily journal entry — Claude asks about your day conversationally

    "Let's catch up"
      Same as journaling but more casual — Claude asks what's been going on

    "Check my inbox"
      Process notes and screenshots you captured on your phone via Todoist

    "Brief me on [person]"
      Pull together everything you've recorded about someone

    "Deep search [topic]"
      Search your journal, texts, and encyclopedia for a topic

    "Interview me about [topic]"
      Claude interviews you to fill gaps in your encyclopedia

    "Update my encyclopedia"
      Route recent journal entries into your encyclopedia source files

    "Compile the encyclopedia"
      Generate the full Encyclopedia document from all source files

    "Draft a fiscal note for [bill]"
      Create an AZ JLBC-style fiscal impact analysis (requires module)

    "Update the elections notebook"
      Refresh candidate and campaign finance data (requires module)
```

Only show sections for layers the user actually has installed. If `~/.claude/toolkit-state/config.json` doesn't exist or can't be read, show everything with "(if installed)" annotations.
