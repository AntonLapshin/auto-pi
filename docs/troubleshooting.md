# Troubleshooting

Common issues and how to resolve them.

## `/doctor` fails

Run `/doctor` (or `npm run doctor`) to see exactly which prerequisite is missing
and how to fix it:

- **Node.js / npm / git / gh missing** — install and ensure they are on PATH.
- **gh not authenticated** — `gh auth login`, then `gh auth status`.
- **gh token scopes** — your token needs `repo` + `workflow`. Run
  `gh auth refresh -s repo -s workflow` (or `gh auth login`).
- **Pi CLI / model not configured** — start pi and pick a provider/model
  (`/model`), and export the matching API key env var.

## `gh` rate limits / transient failures

The loop retries transient GitHub/network failures with exponential backoff and
backs off on rate limits (M13). If you see repeated `gh retry ...` lines, check:

- Are you hitting the GitHub API rate limit? Wait for the reset (the client backs
  off automatically) or raise the token's limits.
- Is `gh auth status` healthy? Re-authenticate if the token expired.

## The loop stops with a "repeated failures" reason

The loop stops after `loop.maxConsecutiveFailures` (default 3) consecutive failed
cycles. Check `.pi/logs/errors.jsonl` and the run records to find the root cause,
fix it, then `/loop-resume` (or `npm run resume`).

## The loop stops with a budget reason

The loop stops when `limits.maxTokensPerDay` / `maxCostPerDayUsd` is reached.
Check `/status` for budget usage. To continue, raise the limit in
`.pi/config.json` and `/loop-resume`.

## An issue keeps failing to implement

The harness caps repeated attempts per issue (`limits.maxIssueAttempts`, default
3). Beyond that it labels the issue `pi:blocked` + `pi:needs-human` and the loop
waits. Review the issue, fix the blocker, remove the labels, and `/loop-resume`.

## A PR has a merge conflict

The harness labels conflicting PRs `pi:conflict` (M13) and routes the Engineer to
resolve them. If the conflict persists, review it manually.

## GitHub Pages deployment failed

Private repos can't use Pages on the free plan. The harness surfaces a
`pi:needs-human` + `pi:blocked` + `type:infra` issue. Make the repo public (or
upgrade the plan), then run `npm run pages` to re-check.

## Secret accidentally in a log / PR

Logs and context packs are redacted, but if a secret was ever written to a
versioned file, rotate the secret immediately (revoke the token / bot token) and
remove it from history. Secrets must never live in `.pi/config.json` or commits —
use the git-ignored `.pi/local.json` / env vars.

## Where are the logs?

- `.pi/logs/latest.log` — latest activity line
- `.pi/logs/runs.jsonl` — one JSON line per persona run
- `.pi/logs/errors.jsonl` — errors
- `.pi/logs/summary.md` — execution summary
- `.pi/logs/loop.out` — the loop process output
- `.pi/runs/{runId}/` — per-run context, stdout, stderr

Use `/logs` (or `npm run logs`) to view them.
