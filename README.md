# Claude Code mods

This repository holds Claude Code mods. A mod changes the Claude Code interface. The repository is also a plugin marketplace, so you can install a mod with one command.

## Claude costs

The `session-costs` mod shows your saved Claude Code cost estimates in a pane beside the chat. It has five tabs with charts: Overview, Trend, Projects, Models and Sessions. It reads only local files and needs no other software.

Install it from the command line:

```sh
claude plugin install session-costs --marketplace rossmeyerza/claude-code-mods
```

Then start Claude Code and enter `/costs`. See [costs/README.md](costs/README.md) for the keys, the tabs and what the numbers mean.

You can also download the zip from the [releases](https://github.com/rossmeyerza/claude-code-mods/releases) page.

## Mod gallery

The `gallery` folder holds a sample mod. It opens a pane that shows text styles, Markdown, code, controls, a link and a drawing. Start Claude Code with `claude --plugin-dir ./gallery`, then enter `/mod-gallery`.

## Build a zip

Run this command from the repository folder:

```sh
mkdir -p dist && cd costs && zip -r ../dist/session-costs-<version>.zip .claude-plugin/plugin.json hooks README.md
```

## Licence

MIT. See [LICENSE](LICENSE).
