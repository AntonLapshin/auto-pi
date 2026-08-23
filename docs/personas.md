# Personas

The auto-pi harness runs a team of personas, each in a **fresh** Pi session with
no memory of prior conversations. All context comes from a focused context file
plus the repository. Personas act autonomously and never ask for confirmation.

## PM (Product Manager)

`personas/pm.md` — plans the project.

- Handles PM notes (`PI-NOTE persona=PM ...`) on issues.
- Revisits `pi:blocked` issues and unblocks them (`pi:ready`) once the obstacle
  (e.g. prerequisite issues) is resolved, so blocked work never stalls the loop.
- Creates small XS/S issues with labels (`size:*`, `type:*`, `milestone:*`) and
  acceptance criteria (`- [ ]` checklist).
- Updates `manifest.md` / `project-state.md`.
- Detects when the project is done and writes the completion marker.

## Engineer

`personas/engineer.md` — implements and ships.

- Picks a `pi:ready` issue, creates a `task/{issueNum}-{slug}` branch.
- Implements in `src/core` (pure) with tests; keeps 100% core coverage.
- Runs lint/test/coverage/build; updates `CHANGELOG.md`.
- Opens a PR (`Closes #N`), addresses review comments, squash-merges approved PRs.
- Handles scope-too-large (leaves a PM note) and merge conflicts (`pi:conflict`).

## Review Engineer

`personas/review-engineer.md` — physically verifies PRs.

- Runs verification commands (lint, tests, 100% coverage, build).
- Inspects the diff and checks acceptance-coverage and missing tests.
- Posts `PI-REVIEW type=... severity=... location=...` comments and approves or
  requests changes.

## Context packs

Each persona gets a focused context (plan §21.1) built by the loop's context
packers:

- `extensions/loop/pm-context.js` — PM context
- `extensions/loop/engineer-context.js` — Engineer context
- `extensions/loop/review-context.js` — Review Engineer context

These read the workspace files, the scanned GitHub state, the target issue/PR,
recent merged PRs, and policy excerpts (`policies/`, plan §25).
