# Done Definition

When a task / issue / PR / project counts as **done** (plan §25).

## A task is done when

- The code is implemented in `src/core` (pure) with thin UI and adapters.
- Every change is covered by tests, and `src/core` is at **100% coverage**.
- Lint, tests, coverage, and build all pass (`npm ci`, `npm run lint`,
  `npm test`, `npm run test:coverage`, `npm run build`).
- The issue's acceptance criteria (`- [ ]` checklist) are all met.
- `CHANGELOG.md` is updated.

## A PR is done when

- It is approved by the Review Engineer (no blocking comments), CI passes, no
  merge conflict, valid scope, and it is squash-merged with the branch deleted.
- The linked issue is closed (`Closes #N`).

## A project is done when

- All planned milestones are implemented, tested, and merged.
- The GitHub Pages demo is deployed (or surfaced as `pi:needs-human` when not
  available on the current plan).
- The PM writes the completion marker (`.pi/state/completed.json`, status
  `done`) and the loop stops, optionally notifying via Telegram.
