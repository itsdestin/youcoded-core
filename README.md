# YouCoded Core

**The bundled foundation plugin for [YouCoded](https://github.com/itsdestin/youcoded)** — safety hooks, a first-run setup wizard, and diagnostic commands for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

> **Status: being phased out.** `write-guard` is moving into the YouCoded app natively, and the personalization skills that used to live here (journaling, personal encyclopedia, task inbox, text messaging, theme building, output styles) are now independent plugins in the [WeCoded marketplace](https://github.com/itsdestin/wecoded-marketplace). This repo will be archived once the app no longer bundles it. New features belong in the app or a marketplace plugin, not here.

Looking for the app? See **[YouCoded](https://github.com/itsdestin/youcoded)** — available on Windows, macOS, Linux, and Android.

## Install

The YouCoded app installs this plugin automatically. To install it standalone with Claude Code:

```bash
git clone https://github.com/itsdestin/youcoded-core.git ~/.claude/plugins/youcoded-core
claude
# then ask Claude to "run the setup wizard"
```

## What's Inside

A single Claude Code plugin (one `plugin.json` at the repo root):

- **Hooks** — `session-start`, `write-guard` (same-machine write-concurrency guard), `worktree-guard` (single-branch policy), `tool-router`, and `statusline`
- **Skills** — `setup-wizard` (conversational first-run: Claude Pro/Max sign-in + environment bootstrap) and `remote-setup` (remote-access pairing flow)
- **Commands** — `/update`, `/health`, `/diagnose`

Journaling, the personal encyclopedia, task inbox processing, text messaging, theme building, and output styles are **no longer part of this plugin** — install them from the [WeCoded marketplace](https://github.com/itsdestin/wecoded-marketplace) inside the app.

## Commands

- `/update` — reconcile hooks into `settings.json` and run migrations
- `/health` — diagnostic summary
- `/diagnose` — deeper diagnostic output

## Contributing

Report bugs or request features via [GitHub Issues](https://github.com/itsdestin/youcoded-core/issues). See the [Contributing Guide](docs/contributing.md) for details.

## License

MIT
