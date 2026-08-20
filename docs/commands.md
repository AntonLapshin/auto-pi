# Commands

The auto-pi harness exposes slash commands (interactive in Pi) and matching
`npm run <cmd>` / `node scripts/<cmd>.js` fallbacks (non-interactive).

| Command | Purpose | Fallback CLI |
|---------|---------|--------------|
| `/seed` | Initiate a new project (clarify, create repo, scaffold, start loop) | `npm run seed` |
| `/stop` | Stop the autonomous loop | `npm run stop` |
| `/status` | Show active project, loop, last run, issues/PRs, budget | `npm run status` |
| `/logs` | Show the latest local logs | `npm run logs` |
| `/loop-resume` | Resume a stopped/paused project's loop | `npm run resume` |
| `/sync-config` | Recopy config defaults, preserving project values | `npm run sync-config` |
| `/doctor` | Validate environment prerequisites | `npm run doctor` |
| `/loop` | Start (or report) the autonomous loop | `npm run loop` |

## `/seed <description>`

Initiates a new project: one-project-per-machine enforcement → clarification →
repo naming → repo creation → local clone → scaffold → config copy → active-project
record → auto-start the loop.

```bash
/seed Build a markdown notes app with tags and search
```

## `/stop`

Writes the stop file; the loop exits at its next cycle.

## `/status`

Reports the active project, loop status (running/stopped/PID), last persona run,
open issues/PRs, and budget usage (tokens today / cost today / limits).

```bash
/status
```

## `/logs [--tail N]`

Shows the latest local logs (prefers `latest.log`, then `summary.md`, then
`loop.out`). `--tail N` controls the number of lines (default 40).

```bash
/logs
/logs --tail 100
```

## `/loop-resume`

Removes the stop marker and starts the loop (if not already running), so a
paused project resumes. (Named `/loop-resume` to avoid clashing with pi's
built-in `/resume` session-switch command.)

```bash
/loop-resume
```

## `/sync-config`

Recopies the harness config defaults into `{project}/.pi/config.json` while
preserving project-specific values (name, repo, owner, email, demo URL, branch,
custom overrides, telegram overrides). Useful after upgrading the harness to pick
up new default knobs.

```bash
/sync-config
```

## `/doctor`

Validates all environment prerequisites (Node, npm, git, gh, gh auth, gh scopes,
Pages, Pi CLI, Pi model/provider, workspace). See [installation.md](installation.md).

## `/loop`

Starts the autonomous loop for the active project (or reports that one is already
running). `/seed` auto-starts the loop; you normally only need `/loop` after a
manual stop or a crash.

```bash
/loop          # start (detached)
/loop --once   # run a single cycle
```
