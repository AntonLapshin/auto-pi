# extensions/loop

Implements the autonomous loop orchestrator (M6): the infinite loop process,
lock/stop files, GitHub state scanner, dispatcher, and fresh persona runner.

## Files

| File               | Purpose |
|--------------------|---------|
| `orchestrator.js`  | The loop core: read config, acquire lock, check active project/stop, scan state, dispatch, build context, run persona, log, sleep, repeat (plan.md §13.1). Also `writeStopFile` / `isStopped` / `acquireLock` / `releaseLock` / `checkLock`. |
| `state-scanner.js` | Reads open issues, open PRs, CI status, labels, and budget usage from GitHub (plan.md §13.1 step 5). |
| `dispatcher.js`    | Decides the next persona per the §15 dispatch order. |
| `pm-context.js`    | PM context packer (M7, plan.md §21.1): reads manifest/project-state/changelog, open issue + PR summaries, recent merged PRs, and policy excerpts for the PM persona. |
| `persona-runner.js`| Launches a fresh Pi persona session: unique run ID, no session persistence, context passed as a file, output captured in the run dir (plan.md §14 / §29.3). |
| `constants.js`     | Shared paths (`.pi/state/loop.lock`, `.pi/state/stop`, `.pi/logs/runs.jsonl`, `.pi/runs/`) and decision/label constants. |
| `index.ts`         | Registers the `/loop` and `/stop` slash commands. |

## Loop state (inside the active project's workspace)

- `.pi/state/loop.lock` — PID + lock file; refuses a second loop for the same project (§13.2).
- `.pi/state/stop` — stop file checked every cycle (§13.3).
- `.pi/logs/loop.out` — nohup stdout/stderr capture.
- `.pi/logs/runs.jsonl` — one JSON line per persona invocation (M10 fills in token/cost).
- `.pi/runs/{runId}/` — per-run context, stdout, stderr.

## CLI / commands

- `npm run loop` (or `node scripts/loop.js`) — run the loop (supports `--once`, `--cycles N`, `--dry-run`).
- `npm run stop` (or `node scripts/stop.js`) — write the stop file.
- `/loop` and `/stop` interactive commands registered here.
- `/seed` auto-starts the loop via `nohup node scripts/loop.js > .pi/logs/loop.out 2>&1 &`.

The core is plain JS so it is shared between the fallback CLIs (`scripts/loop.js`,
`scripts/stop.js`) and the interactive commands (`index.ts`), matching the doctor
and seed conventions.
