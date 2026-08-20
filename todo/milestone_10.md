# Milestone 10: Logging and Execution Summary

**Depends on:** Milestone 6
**Reference:** plan.md §20, §28 "Milestone 10"

## Goal

Implement local, git-ignored run/error/summary logging and token-usage accounting for the loop.

## Tasks

- [x] Implement the logging skill (skills/logging) writing to `{workspace}/.pi/logs/`:
  - `runs.jsonl`
  - `errors.jsonl`
  - `summary.md`
  - `summary.jsonl`
  - `latest.log`
- [x] Run-log schema (plan.md §20.1): runId, startedAt, finishedAt, persona, trigger, projectName, repo, issueNumber, prNumber, status, action, reason, error, tokensInput, tokensOutput, tokensTotal, durationSeconds, gitSha.
- [x] Implement logging helpers: append JSONL records, write latest.log, roll error logs on failure.
- [x] Implement token-usage tracking from each persona run and write per-day/per-cycle accumulation (feeds budget guard in M13 and `/loop-status`).
- [x] Generate `summary.md` (plan.md §20.2): last run info, today's run count/success/fail, tokens used, estimated cost, active work (open issues, open PRs, last merged PR, project state).
- [x] Secret redaction: never write tokens/secrets into logs (plan.md §20, §7.2). Implement `logging.redactSecrets` and redaction helper.
- [x] Ensure `.pi/logs/` is git-ignored in generated projects (verify with M5/M10 .gitignore).
- [x] Config-driven rotation: `logging.maxFileSizeMb` (default 10) and `logging.rotate`.

## Acceptance Criteria

A user can open `.pi/logs/summary.md` and understand the latest activity (last persona run, totals, active work, cost).

`runs.jsonl` contains valid run records with all schema fields; no secrets appear in any log.
