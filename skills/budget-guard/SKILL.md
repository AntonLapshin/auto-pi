---
name: budget-guard
description: >
  Enforce the auto-pi token/cost budgets (plan.md §21). Checks the per-cycle,
  per-day, and per-cost limits from `config.limits` against the current usage
  and reports whether the loop should stop, and enforces the per-persona
  context/output token caps.
---

# budget-guard

Enforces the auto-pi budget guardrails (plan.md §21, M13). The loop calls
`checkBudget()` before dispatching a persona and before launching a session so
a runaway spend is caught early and the loop stops gracefully with a clear log
line instead of crashing.

## Limits enforced (config.limits)

| Key                         | Default | Meaning                                        |
|-----------------------------|---------|------------------------------------------------|
| `maxTokensPerCycle`         | 0       | max tokens in one loop cycle; `0` = unlimited  |
| `maxTokensPerDay`           | 0       | max tokens in one day; `0` = unlimited         |
| `maxCostPerDayUsd`          | 20      | max estimated cost per day (USD)               |
| `maxPromptTokensPerPersona` | 0       | max prompt tokens a persona may consume; `0` = unlimited |
| `maxOutputTokensPerPersona` | 0       | max output tokens a persona may produce; `0` = unlimited |

Plus `pi.contextMaxTokens` (default 0 — unlimited) — the model context window
the persona context packers must stay under.

## Behavior

- `checkBudget(config, usage)` returns `{ exceeded, reason }`. It is a pure
  function: given the parsed config and the usage summary from
  `skills/logging` (`readUsage`), it reports whether any per-day/per-cost limit
  is exceeded.
- The loop calls it every cycle (already wired via `state-scanner.budgetExceeded`);
  this skill centralises the limit constants and adds the per-cycle check.
- `maxConsecutiveFailures` (default 3) is enforced by the orchestrator: a run of
  consecutive persona/cycle failures stops the loop with a
  `repeated-failure` stop reason.

## Enforcing the per-persona token caps

The persona runner (`extensions/loop/persona-runner.js`) passes
`config.pi.contextMaxTokens`, `config.limits.maxPromptTokensPerPersona`, and
`config.limits.maxOutputTokensPerPersona` to the `pi` CLI flags (`--max-context`,
`--max-prompt`, `--max-output`) when the installed pi supports them, so the
model is capped at the persona level as well as the loop level. A value of `0`
means the cap is disabled (unlimited) — no flag is emitted.

Core logic lives in `skills/budget-guard/core.js` (plain JS, shared with the
loop and tests).
