# Contributing

How to develop the auto-pi harness itself (this repo — not the projects it
generates; those follow the scaffolded project's own README).

## Dev setup

Prerequisites: Linux, Node.js ≥ 18 + npm, git, GitHub CLI `gh`, Pi.
See [`docs/installation.md`](docs/installation.md), then:

```bash
npm install          # root harness deps (none for the UI — see below)
npm test             # all 19 backend suites (node --test)
cd ui && npm install # UI deps (Vite + React + TS + Tailwind)
```

Validate the environment anytime with `/loop-doctor` (or `npm run doctor`).

## Checks

Every harness change ships with tests + docs. Run before pushing:

```bash
npm test             # backend suites (see tests/README.md for the list)
npm run ui:build     # production UI build (also typechecks via vite build)
```

Generated projects enforce `lint + test + coverage + build` (see
`policies/testing-policy.md`); hold harness changes to the same bar —
`npm test` green plus UI build green is the minimum. (Lint/format/CI
gating for the harness itself is planned; see `REFACTOR_PLAN.md` Phase C.)

## Commit style

Short imperative summary, optionally scoped — e.g. `fix(loop): …`,
`Implement /loop-pull command`, `Update README`. Reference the milestone or
issue when the change belongs to one (e.g. `(M13)`).

## How to add things

- **Command** (`/loop-<name>`): implement core in `extensions/<area>/` or
  `skills/*/core.js`, register the slash command in the area's `index.ts`
  (via `pi.registerCommand()`), add the fallback `scripts/<name>.js` +
  `npm run <name>` entry, document it in `docs/commands.md` (+
  `docs/architecture.md` command-mapping table), cover it in `tests/`.
- **Skill**: new `skills/<name>/` with `core.js` (pure, tested) + `SKILL.md`
  (Pi wrapper); wire into the loop or persona contexts that need it.
- **Persona behavior**: edit `personas/<name>.md` + the matching
  `extensions/loop/<name>-context.js` packer; both must stay in sync, with
  tests in `tests/<name>.test.js` (`pm`/`engineer`/`review`).
- **Policy**: add `policies/<name>.md`, excerpt it into the persona contexts
  that enforce it (see `docs/architecture.md`), list it in
  `policies/README.md` and `todo/milestone_13.md` docs section.
- **Template** (generated projects): edit `templates/project/*.j2`; every
  template must render — add/extend scaffold coverage in
  `tests/scaffold.test.js`.

Keep adapters thin and core tested (see
`policies/engineering-guidelines.md`): no logic in `scripts/` CLIs,
extension index files, or UI components that isn't covered through an
importable core module.

## PR checklist

- [ ] Tests added/updated; `npm test` green (see `tests/README.md`)
- [ ] `npm run ui:build` green (if UI touched)
- [ ] Docs updated: `docs/` canonical page (not a copy — see
  `docs/architecture.md` for which page owns which topic), `tests/README.md`
  if suites changed, `CHANGELOG.md` entry under Unreleased
- [ ] No secrets in logs/contexts/PRs (`policies/security-policy.md`;
  redaction via `skills/logging`)
- [ ] Commit message follows the style above; linked issue/milestone noted
- [ ] Against `policies/done-definition.md`: no skeleton markers left,
  acceptance criteria demonstrably met
