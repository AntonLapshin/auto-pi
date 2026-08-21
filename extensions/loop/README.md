# extensions/loop

Implements the autonomous loop orchestrator (M6): the infinite loop process,
lock/stop files, GitHub state scanner, dispatcher, and fresh persona runner.

## Files

| File               | Purpose |
|--------------------|---------|
| `orchestrator.js`  | The loop core: read config, acquire lock, check active project/stop, scan state, dispatch, build context, run persona, log, sleep, repeat (plan.md §13.1). Also `writeStopFile` / `isStopped` / `acquireLock` / `releaseLock` / `checkLock`, plus the `/loop-restart` helpers: `removeStopFile` / `waitForLoopExit` / `startLoopDetached` / `restartLoop`, and the `/loop-switch` helpers: `listProjects` / `resolveProject` / `writeActiveProjectRecord` / `switchProject`. |
| `state-scanner.js` | Reads open issues, open PRs, CI status, labels, and budget usage from GitHub (plan.md §13.1 step 5). |
| `dispatcher.js`    | Decides the next persona per the §15 dispatch order. |
| `pm-context.js`    | PM context packer (M7, plan.md §21.1): reads manifest/project-state/changelog, open issue + PR summaries, recent merged PRs, and policy excerpts for the PM persona. |
| `engineer-context.js` | Engineer context packer (M8, plan.md §21.1): resolves the target work item (implement a `pi:ready` issue / address review comments / merge an approved PR), includes the issue body + comments, PR review comments, project structure, test commands, recent merged PRs, and policy excerpts for the Engineer persona. |
| `review-context.js` | Review Engineer context packer (M9, plan.md §21.1): resolves the target PR (a `pi:review-needed` / review-requested PR), includes the PR body + diff summary, linked issue + acceptance criteria, review settings (`reviewerCanPushTestCommits`), verification commands, review rules, and policy excerpts for the Review Engineer persona. |
| `persona-runner.js`| Launches a fresh Pi persona session: unique run ID, no session persistence, context passed as a file, output captured in the run dir (plan.md §14 / §29.3). M10 adds full run-log records (plan.md §20.1) and token/cost accounting via `skills/logging/core.js`. M13 adds `runPersonaWithRetry` — a retry/backoff wrapper around the LLM invocation so a single transient provider failure (network blip, 5xx, timeout, rate limit, empty output) is retried with exponential backoff + jitter instead of burning a loop cycle; non-transient failures fail fast. Tuned via `config.pi.maxRetries` (default 2), `retryBaseDelayMs` (5000), `retryMaxDelayMs` (30000). |
| `constants.js`     | Shared paths (`.pi/state/loop.lock`, `.pi/state/stop`, `.pi/logs/runs.jsonl`, `.pi/runs/`) and decision/label constants. |
| `index.ts`         | Registers the `/loop`, `/loop-stop`, `/loop-restart`, and `/loop-switch` slash commands. |

## Loop state (inside the active project's workspace)

- `.pi/state/loop.lock` — PID + lock file; refuses a second loop for the same project (§13.2).
- `.pi/state/stop` — stop file checked every cycle (§13.3).
- `.pi/logs/loop.out` — nohup stdout/stderr capture.
- `.pi/logs/runs.jsonl` — one JSON line per persona invocation (M10 fills in token/cost).
- `.pi/logs/errors.jsonl` — one JSON line per logged error / failed run (M10).
- `.pi/logs/summary.md` + `summary.jsonl` — execution summary (M10).
- `.pi/logs/latest.log` — latest activity line (M10).
- `.pi/logs/usage.jsonl` — per-day/per-cycle token accumulation (M10).
- `.pi/runs/{runId}/` — per-run context, stdout, stderr.

## CLI / commands

- `npm run loop` (or `node scripts/loop.js`) — run the loop (supports `--once`, `--cycles N`, `--dry-run`).
- `npm run stop` (or `node scripts/stop.js`) — pause the loop (write the stop file; preserves the active-project record).
- `npm run restart` (or `node scripts/restart.js`) — safely restart the loop (stop, wait, start again; `--timeout N`).
- `npm run switch` (or `node scripts/switch.js`) — switch the active project to another locally-seeded project (`--list`, `--no-start`, `--timeout N`).
- `/loop`, `/loop-stop`, `/loop-restart`, and `/loop-switch` interactive commands registered here.
- `/loop-seed` auto-starts the loop via `nohup node scripts/loop.js > .pi/logs/loop.out 2>&1 &`.

The core is plain JS so it is shared between the fallback CLIs (`scripts/loop.js`,
`scripts/stop.js`) and the interactive commands (`index.ts`), matching the doctor
and seed conventions.
