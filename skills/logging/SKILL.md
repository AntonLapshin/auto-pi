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
| `events.jsonl`  | Structured, deterministic progress events (persona spawn/finish, git/gh commands, issue/PR lifecycle, dispatch, LLM retries) — the auto-pi UI timeline |
| `health.jsonl`  | Per-invocation LLM-provider health records (success/failure, exit code, retries, duration) — powers provider success rate |

## Run-log schema (plan.md §20.1)

`runId, startedAt, finishedAt, persona, trigger, projectName, repo,
issueNumber, prNumber, status, action, reason, error, tokensInput,
tokensOutput, tokensTotal, durationSeconds, gitSha`.

## Event-ledger schema (`events.jsonl`)

One JSON line per deterministic progress event: `{ version, id, at, type,
persona, runId, data }`. `type` is a dotted string; `data` is a structured,
plain object (no prose) so the UI can aggregate reliably. Emitted types:

- `persona.spawned` / `persona.finished` / `persona.failed` — lifecycle
- `loop.dispatch` / `loop.stop` / `loop.wait` — dispatcher decisions
- `git.command`, `git.commit`, `git.push`, `git.stage`, `git.checkout`, …
- `gh.command`, `issue.created`, `issue.closed`, `issue.edited`,
  `pr.created`, `pr.merged`, `pr.approved`, `pr.reviewed`,
  `pr.commented`, `pr.changes_requested`, `labels.assigned`, …
- `llm.retry` — a transient provider failure that was retried

## Health-ledger schema (`health.jsonl`)

One record per persona invocation outcome plus one per retry attempt:
`{ version, at, provider, model, runId, persona, ok, exitCode, retries,
retryable, durationMs, reason }`. Used to compute LLM-provider success rate.

## Git-command observability

The personas drive the project through `git` / `gh` CLI commands. The runner
parses the captured stdout/stderr (`parseGitCommands`) and records each command
as an event, classifying lifecycle commands (`classifyGitCommand`) into
issue/PR/label events so the UI can render project progress without parsing
prose.

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
  appendEvent, appendHealth, readEvents, readHealth,
  parseGitCommands, classifyGitCommand,
} from "../skills/logging/core.js";

await appendRunRecord(workspace, buildRunRecord({ runId, persona, status: "ok" }));
await accumulateTokens(workspace, { tokensInput, tokensOutput, tokensTotal });
await appendEvent(workspace, { type: "pr.merged", persona, runId, data: { prNumber } });
await appendHealth(workspace, { provider, model, runId, persona, ok: true });
const commands = parseGitCommands(stdout, stderr);
await writeSummary({ workspace, config, state, lastRun, errors });
```
