---
name: status
description: >
  Build the auto-pi `/loop-status` report: active project, loop status, last persona
  run, open issues/PRs, and budget usage (plan.md §3.3, M13).
---

# status

Builds the `/loop-status` report for the auto-pi harness (plan.md §3.3, M13).

## Report contents

The report includes:

- **Project** — name, repo, workspace, started-at timestamp
- **Loop status** — running (PID + started-at), stopped (stop file present), or
  not running
- **Budget** — tokens used today / per-day limit, estimated cost today / per-day
  limit, cycle token budget
- **Last persona run** — persona, status, action, reason, started-at, tokens
- **Recent errors** — the last 5 logged errors
- **GitHub** (when a `gh` runner is available) — open issues and PRs with labels

## Usage

The interactive `/loop-status` command (`extensions/harness.ts`) and the fallback CLI
(`scripts/status.js`) both delegate to `buildStatus()` in this skill, so they
report identical results.

Core logic lives in `skills/status/core.js` (plain JS).
