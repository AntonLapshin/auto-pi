# Milestone 13: Hardening

**Depends on:** Milestone 12 (pilot learnings)
**Reference:** original build plan (§28 "Milestone 13", §29, §31, §7.2; historical — canonical docs: README.md, docs/architecture.md, docs/commands.md)

## Goal

Harden the harness against real-world failure modes and productionize the remaining pieces.

## Tasks

### Reliability
- [x] Retry/backoff for transient GitHub and network errors.
- [x] GitHub rate-limit handling: detect rate limits, back off, retry with `X-RateLimit-Reset`.
- [x] Stale branch cleanup: close obsolete feature branches after merge/abandon.
- [x] Failed-issue limits: cap repeated attempts per issue (`limits.maxIssueAttempts`, default 3).
- [x] Conflict handling: detect merge conflicts, label `pi:conflict`, and route to Engineer for resolution.
- [x] `maxConsecutiveFailures` (default 3) → stop loop with repeated-failure stop reason.

### Budget / token guardrails
- [x] Implement budget guard (skills/budget-guard):
  - `maxTokensPerCycle` (0 = unlimited), `maxTokensPerDay` (0 = unlimited), `maxCostPerDayUsd` (0 = unlimited)
  - stop on budget exceeded (`loop.stopOnBudgetExceeded`)
  - enforce `pi.contextMaxTokens`, `maxPromptTokensPerPersona`, `maxOutputTokensPerPersona` (all `0` = unlimited by default)

### Security / data
- [x] Secret redaction everywhere (logs, PR bodies, context packs) — never leak `.pi/local.json` or env tokens.
- [x] Log rotation honoring `logging.maxFileSizeMb` / `logging.rotate`.

### Config validation
- [x] Validate `config.json` against `config.schema.json` at loop start and `/loop-seed` (zod or JSON schema).
- [x] `/loop-sync-config` (recopy defaults while preserving project-specific values) — original plan §3.3.

### Remaining commands
- [x] `/loop-status` — active project, loop status, last persona run, open issues/PRs, budget usage (original plan §3.3).
- [x] `/loop-logs` — show latest local logs.
- [x] `/loop-resume {project}` — resume a stopped/paused project if not completed.
- [x] Wire `/loop-logs`, `/loop-resume`, `/loop-sync-config` into extension index + `package.json` commands + fallback scripts.

### Documentation
- [x] Complete docs: installation, github-token, configuration, commands, personas, github-pages, telegram, troubleshooting.
- [x] Ensure all policies written: engineering-guidelines, testing-policy, ui-thin-layer-policy, issue-granularity, pr-policy, dependency-policy, security-policy, done-definition.

> Verified against `eb97869 Implement M13 hardening` + follow-ups
> (`7815446` persona retry, `9504014` wall-clock persona timeout, `dc5aa3c`
> lock-deadlock fix, `c17c39c` `/loop-provider`, `f5d2e5b` `/loop-switch`,
> `21d12db` `/loop-restart`, `1977b0b` `/loop-pull`, `eadfe33` UI monitor):
> all items above are implemented and covered by `tests/hardening.test.js`
> (+ `persona-retry`, `provider-config`, `pull`, `loop` suites).

## Acceptance Criteria

- Loop survives transient failures without crashing.
- Budget/rate limits stop the loop gracefully with clear logs.
- Config is validated; invalid config fails fast at `/loop-seed`/loop start.
- `/loop-status`, `/loop-logs`, `/loop-resume`, `/loop-sync-config` all work.
- Security: no secrets in logs/contexts/PRs.
