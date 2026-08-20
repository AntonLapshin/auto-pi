# Engineering Guidelines

Guidelines that bound how the auto-pi personas write and ship code. These are
excerpted into persona context packs (plan §21, §25) so every fresh persona
session follows the same engineering contract.

## Architecture (plan §17.3 / §19)

The project follows a strict layered architecture:

- **`src/core`** — pure business logic. No React, no Tailwind, no browser APIs
  (`document`, `window`, `localStorage`, `fetch`, `navigator`, ...). Must be
  **100% covered** by tests.
- **`src/ui/viewModels`** — thin view models. No business logic; they only bind
  core functions to component state.
- **`src/ui/components`** — thin, dumb components. No business logic; they render
  props and call view-model/callback props.
- **`src/adapters`** — storage / fetch / external adapters. Impure I/O lives here,
  never in core.

**Core must not import React/Tailwind or access browser APIs.** If you need to
touch the DOM or a browser API, put it in an adapter or a thin component.

## Working contract

- **Fresh sessions only.** Personas never remember prior conversations; all
  context comes from the context file + the repo. Act autonomously; do not ask
  for confirmation.
- **Stay scoped.** Never implement code outside the current issue/PR's scope.
- **Never ship untested logic.** Every change adds a test; core stays at 100%
  coverage.
- **Never put business logic in the UI.** Core stays pure; UI stays thin.
- **Never partial-implement a too-large issue.** Stop and leave a PM note
  (`PI-NOTE persona=PM reason=scope-too-large action=split`) instead.
- **Never merge an unapproved / failing / conflicting PR.**

## Quality bar

- Lint, tests, coverage, and build must all pass before opening a PR.
- Core coverage is 100% (`npm run test:coverage`).
- Every PR links its issue (`Closes #N`) and updates `CHANGELOG.md`.
