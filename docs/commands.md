# Commands

The auto-pi harness exposes slash commands (interactive in Pi) and matching
`npm run <cmd>` / `node scripts/<cmd>.js` fallbacks (non-interactive).

| Command | Purpose | Fallback CLI |
|---------|---------|--------------|
| `/loop-seed` | Initiate a new project (clarify, create repo, scaffold, start loop) | `npm run seed` |
| `/loop-stop` | Stop the autonomous loop | `npm run stop` |
| `/loop-restart` | Safely restart the autonomous loop | `npm run restart` |
| `/loop-status` | Show active project, loop, last run, issues/PRs, budget | `npm run status` |
| `/loop-logs` | Show the latest local logs | `npm run logs` |
| `/loop-resume` | Resume a stopped/paused project's loop | `npm run resume` |
| `/loop-sync-config` | Recopy config defaults, preserving project values | `npm run sync-config` |
| `/loop-doctor` | Validate environment prerequisites | `npm run doctor` |
| `/loop` | Start (or report) the autonomous loop | `npm run loop` |

## `/loop-seed <description>`

Initiates a new project: one-project-per-machine enforcement → **explicit project
name** → clarification → repo naming → repo creation → local clone → scaffold →
config copy → active-project record → auto-start the loop.

The command asks for an explicit **project name** (used for the repo slug and
display name); the `<description>` argument (optional) is used for clarification.

```bash
/loop-seed Build a markdown notes app with tags and search
```

## `/loop-stop`

Writes the stop file (the loop exits at its next cycle) **and clears the
active-project record**. Stopping "finishes" the project and releases the
one-project-per-machine slot, so you can immediately run `/loop-seed` again to
start a new project.

```bash
/loop-stop
npm run stop
```

> Note: clearing the active-project record means a stopped project can no
> longer be resumed with `/loop-resume`. If you only want to pause the loop
> while keeping the project active, stop the loop process directly (kill the
> PID from `/loop-status`); the active-project record stays intact.

## `/loop-restart [--timeout N]`

Safely restarts the autonomous loop for the **same** active project. Unlike
`/loop-stop`, the active-project record is **preserved**, so the restarted loop
resumes the same project.

It restarts safely by:

1. writing the stop file so the running loop (if any) exits at its next cycle
   boundary — any in-flight persona finishes normally (never SIGKILLed);
2. waiting (polling) for the loop process to actually exit so its lock is
   released and it can't fight the new loop for the lock;
3. removing the stop marker so the fresh loop doesn't immediately exit;
4. starting a new loop detached (`setsid nohup`, output to `.pi/logs/loop.out`).

If the old loop hasn't exited within the timeout (it may be mid-persona), the
restart aborts rather than risk a double loop — the loop has been asked to stop
and will exit on its own; run `/loop-restart` again shortly. Use `--timeout N`
to wait up to *N* seconds (default 60).

```bash
/loop-restart
/loop-restart --timeout 120
npm run restart
```

## `/loop-status`

Reports the active project, loop status (running/stopped/PID), last persona run,
open issues/PRs, and budget usage (tokens today / cost today / limits).

```bash
/loop-status
```

## `/loop-logs [--tail N]`

Shows the latest local logs (prefers `latest.log`, then `summary.md`, then
`loop.out`). `--tail N` controls the number of lines (default 40).

```bash
/loop-logs
/loop-logs --tail 100
```

## `/loop-resume`

Removes the stop marker and starts the loop (if not already running), so a
paused project resumes. (Named `/loop-resume` to avoid clashing with pi's
built-in `/resume` session-switch command.)

Resume requires an active project record. After `/loop-stop` clears the record,
resume reports that no active project exists and points you to `/loop-seed`.

```bash
/loop-resume
```

## `/loop-sync-config`

Recopies the harness config defaults into `{project}/.pi/config.json` while
preserving project-specific values (name, repo, owner, email, demo URL, branch,
custom overrides, telegram overrides). Useful after upgrading the harness to pick
up new default knobs.

```bash
/loop-sync-config
```

## `/loop-doctor`

Validates all environment prerequisites (Node, npm, git, gh, gh auth, gh scopes,
Pages, Pi CLI, Pi model/provider, workspace). See [installation.md](installation.md).

## `/loop`

Starts the autonomous loop for the active project (or reports that one is already
running). `/loop-seed` auto-starts the loop; you normally only need `/loop` after a
manual stop or a crash.

```bash
/loop          # start (detached)
/loop --once   # run a single cycle
```
