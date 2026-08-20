# policies

Harness-wide policies that bound persona behaviour and project quality. These are
excerpted into persona context packs (plan §21, §25).

Implemented (M13):

- `engineering-guidelines.md` — architecture (core/view-models/components/adapters),
  working contract, quality bar
- `testing-policy.md` — every change is tested; 100% core coverage; review cases
- `ui-thin-layer-policy.md` — UI stays a thin, dumb layer; no business logic
- `issue-granularity.md` — XS/S issues only; labels; acceptance criteria; splitting
- `pr-policy.md` — branch naming, issue linking, review, squash-merge, conflict handling
- `dependency-policy.md` — pinned versions, no unsafe deps, minimal surface
- `security-policy.md` — no secrets in logs/contexts/PRs; `.pi/local.json` git-ignored
- `done-definition.md` — when a task / PR / project counts as done

Each policy is excerpted into the relevant persona context pack
(`extensions/loop/*-context.js`, plan §21.1).
