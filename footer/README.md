# Footer

The `footer` mod adds a coloured footer under the Claude Code prompt. It shows:

- the folder, the git branch and the model;
- the context window used;
- the 5-hour and 7-day limits that remain, with reset times;
- the session cost estimate.

The layout adapts to the terminal width. When space is short, it drops reset times first, then bars, and keeps every percentage.

## Install

```sh
claude plugin install footer --marketplace rossmeyerza/claude-code-mods
```

The footer appears in the next session. It reads local session data only and makes no extra API requests.

## Optional: export the limits

Set `CLAUDE_FOOTER_EXPORT` to a command, for example a status-bar script. After each turn, the mod runs the command and writes the limits to its standard input as JSON:

```json
{ "version": 1, "observed_at": 1795600000, "rateLimits": [ { "kind": "five_hour", "percentUsed": 23, "resetsAt": "..." } ] }
```

The mod splits the command on spaces and runs it without a shell. If the command fails, the mod writes the error to the debug log only. Without the variable, the mod exports nothing.
