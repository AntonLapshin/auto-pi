# Logging & Execution Summary

Local, git-ignored run/error/summary logging and token-usage accounting for the
auto-pi autonomous loop (Milestone 10, plan.md §20, §28).

All logs live under the active project's workspace in `{workspace}/.pi/logs/`,
which is git-ignored in generated projects (see `templates/project/.gitignore.j2`).

## Files written

| File            | Purpose                                                        |
|-----------------|----------------------------------------------------------------|
| `runs.jsonl`    | One JSON line per persona run (plan.md §20.1 schema)            |
| `errors.jsonl`  | One JSON line per logged error / failed run                     |
| `summary.md`    | Human-readable execution summary (plan.md §20.2)                |
| `summary.jsonl` | Machine-readable summary records (one per summary write)        |
| `latest.log`    | Latest plain-text activity line (tail-friendly)                 |
| `usage.jsonl`   | Per-day / per-cycle token accumulation (feeds M13 + `/loop-status`)  |

## Run-log schema (plan.md §20.1)

`runId, startedAt, finishedAt, persona, trigger, projectName, repo,
issueNumber, prNumber, status, action, reason, error, tokensInput,
tokensOutput, tokensTotal, durationSeconds, gitSha`.

## Secret redaction

Logs must never contain tokens or secrets (plan.md §20, §7.2). Use
`redactSecrets()` on any text before writing it to a log. The loop's logging
helpers redact automatically; do not bypass them.

## Rotation

Config-driven rotation via `config.logging`:
- `maxFileSizeMb` (default 10) — roll a log file when it exceeds this size.
- `rotate` (default true) — enable/disable rotation.

## Usage

The core is plain JS at `skills/logging/core.js`, imported by the loop
orchestrator and persona runner (and directly by tests / node scripts).

```js
import {
  appendRunRecord, appendErrorRecord, writeSummary,
  accumulateTokens, redactSecrets,
} from "../skills/logging/core.js";

await appendRunRecord(workspace, buildRunRecord({ runId, persona, status: "ok" }));
await accumulateTokens(workspace, { tokensInput, tokensOutput, tokensTotal });
await writeSummary({ workspace, config, state, lastRun, errors });
```
