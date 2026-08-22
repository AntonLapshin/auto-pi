# Milestone 13: Hardening

**Depends on:** Milestone 12 (pilot learnings)
**Reference:** plan.md §28 "Milestone 13", §29, §31, §7.2

## Goal

Harden the harness against real-world failure modes and productionize the remaining pieces.

## Tasks

### Reliability
- [ ] Retry/backoff for transient GitHub and network errors.
- [ ] GitHub rate-limit handling: detect rate limits, back off, retry with `X-RateLimit-Reset`.
- [ ] Stale branch cleanup: close obsolete feature branches after merge/abandon.
- [ ] Failed-issue limits: cap repeated attempts per issue (`limits.maxIssueAttempts`, default 3).
- [ ] Conflict handling: detect merge conflicts, label `pi:conflict`, and route to Engineer for resolution.
- [ ] `maxConsecutiveFailures` (default 3) → stop loop with repeated-failure stop reason.

### Budget / token guardrails
- [ ] Implement budget guard (skills/budget-guard) enforcing plan.md §21:
  - `maxTokensPerCycle` (0 = unlimited), `maxTokensPerDay` (0 = unlimited), `maxCostPerDayUsd` (0 = unlimited)
  - stop on budget exceeded (`loop.stopOnBudgetExceeded`)
  - enforce `pi.contextMaxTokens` (150000), `maxPromptTokensPerPersona` (135000), `maxOutputTokensPerPersona` (8000)

### Security / data
- [ ] Secret redaction everywhere (logs, PR bodies, context packs) — never leak `.pi/local.json` or env tokens.
- [ ] Log rotation honoring `logging.maxFileSizeMb` / `logging.rotate`.

### Config validation
- [ ] Validate `config.json` against `config.schema.json` at loop start and `/loop-seed` (zod or JSON schema).
- [ ] `/loop-sync-config` (recopy defaults while preserving project-specific values) — plan.md §3.3.

### Remaining commands
- [ ] `/loop-status` — active project, loop status, last persona run, open issues/PRs, budget usage (plan.md §3.3).
- [ ] `/loop-logs` — show latest local logs.
- [ ] `/loop-resume {project}` — resume a stopped/paused project if not completed.
- [ ] Wire `/loop-logs`, `/loop-resume`, `/loop-sync-config` into extension index + `package.json` commands + fallback scripts.

### Documentation
- [ ] Complete docs: installation, github-token, configuration, commands, personas, github-pages, telegram, troubleshooting (plan.md §4 `docs/`).
- [ ] Ensure all policies written: engineering-guidelines, testing-policy, ui-thin-layer-policy, issue-granularity, pr-policy, dependency-policy, security-policy, done-definition (plan.md §4 `policies/`, §25).

## Acceptance Criteria

- Loop survives transient failures without crashing.
- Budget/rate limits stop the loop gracefully with clear logs.
- Config is validated; invalid config fails fast at `/loop-seed`/loop start.
- `/loop-status`, `/loop-logs`, `/loop-resume`, `/loop-sync-config` all work.
- Security: no secrets in logs/contexts/PRs.
