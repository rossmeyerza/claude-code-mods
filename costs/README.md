# Claude costs

A Claude Code mod that shows your saved Claude Code cost estimates in a pane beside the chat. It has five tabs with charts: Overview, Trend, Projects, Models and Sessions.

## Install

The mod needs nothing else: it reads the transcripts through Claude Code itself.

- **From a folder:** start Claude Code with `claude --plugin-dir <path to this folder>`.
- **From a zip in the Claude desktop app:** upload the zip as a plugin, then start a new local Code session.

Enter `/costs` to open the pane.

## Use

Press ctrl+x tab to give the pane the focus in the terminal. Then use these keys:

| Key | Action |
| --- | --- |
| `1` | Overview: the average spend for each day over the last 7 days, the month total at that rate, the cache-read share, the top project, and the daily spend stacked by model family. |
| `2` | Trend: a taller daily chart, the busiest day, the active days, and a calendar of daily spend for all time. |
| `3` | Projects: the spend for each project folder. |
| `4` | Models: the share of spend and the tokens for each model family. |
| `5` | Sessions: the most expensive sessions, with the project, the main model and the API time. |
| `p` | Change the period: 7 days, 30 days, 90 days or all time. |
| `r` | Read the transcripts again. |

On the desktop app, click the tabs and buttons. The terminal draws the charts in truecolour cells. The desktop app, VS Code and the mobile apps draw them as SVG. When the desktop app shows the pane as a small widget, the pane shows only the total, the change and the last 14 days.

## What the numbers mean

The pane reads the last `cost-state` record in each top-level session transcript under `~/.claude/projects/`. If set, `CLAUDE_CONFIG_DIR` replaces `~/.claude`. The scan excludes nested transcripts, so it does not count subagent costs a second time. The project is the folder in which the session started.

The totals are Claude Code's USD estimates, not invoice charges. Each session counts on its UTC start date. The pane does not split a session across days. "This month" adds the 7-day average for the remaining days to the spend so far. The comparison with the previous period shows only when saved records cover that period.

The pane does not estimate costs for sessions without a saved record. Recent activity can be absent until Claude Code saves a new record. Some sessions share a start time. They possibly come from one process, and their saved costs can then repeat. The footer shows the amount that can repeat. The total does not remove it.

The first read goes through every transcript and can take some seconds. The pane shows its progress. The mod keeps a cache of what it read in its own plugin storage. A later read takes only the bytes added to each transcript since the last read, so it is fast. If a read stops for more than 5 seconds, the pane tells you, and `r` continues it.

The pane reads only local files. It sends nothing over the network.

## Tests

The tests are in the source folder, not in the zip. Run them from the source folder:

```sh
node --test scan.test.mjs view.test.mjs
claude plugin test .
```
