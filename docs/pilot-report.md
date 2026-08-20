# auto-pi Pilot Report (Milestone 12)

Date: 2026-08-20
Pilot command: `/loop-seed Build a markdown notes app with tags and search`
GitHub owner: `AntonLapshin`
Pilot repo: `AntonLapshin/build-a-markdown-notes-app-with-tags-and-search`

This report records a real, end-to-end run of the auto-pi harness against a live
GitHub account and a live model provider. Its purpose is to validate the whole
harness (Milestone 12) and to surface hardening recommendations for Milestone 13.

## 1. Prerequisites / doctor

- `gh` authenticated as `AntonLapshin` with scopes `repo` + `workflow` (plus
  `gist`, `read:org`). ✓
- `npm run doctor` — **all 10 checks passed** (Node, npm, git, gh, gh auth, gh
  scopes, Pages best-effort, Pi CLI, Pi model/provider, workspace). ✓

## 2. Seed / initiation

- `/loop-seed` (via `npm run seed -- "... " --yes`) completed: clarification used
  assumptions (`use assumptions` path), repo
  `AntonLapshin/build-a-markdown-notes-app-with-tags-and-search` was created
  (private), 23 scaffold files written, `.pi/config.json` + schema + local-secrets
  scaffold copied with correct project values, active-project record written,
  and the autonomous loop auto-started under `nohup`. ✓
- README contains the live demo URL
  `https://AntonLapshin.github.io/build-a-markdown-notes-app-with-tags-and-search/`. ✓
- Scaffold verified demoable/testable: `npm install`, `npm test` (7 tests),
  `npm run build`, and `npm run test:coverage` (100% on `src/core`) all pass;
  the UI stays thin (`src/ui` has no business logic). ✓
- CI (`ci.yml`) and GitHub Pages (`deploy-pages.yml`) workflows generated and
  present in `.github/workflows/`. ✓

## 3. Loop lifecycle

The loop scanned GitHub state, dispatched personas, built focused contexts, and
recorded every run+error+summary to `.pi/logs/` with **no secrets**. It also
recovered cleanly from a failed persona session (recorded the error and
re-dispatched). ✓

### PM persona
Created labeled issues for the first slice:
- #1 `Core notes model ... CRUD + tag normalization` (`pi:ready, size:xs,
  type:feature, milestone:m1`)
- #2 `Core search + tag filtering for notes` (same labels)

Updated `manifest.md` / `project-state.md` and committed+pushed. ✓

### Engineer persona
- Implemented issue #1 → `src/core/notes.ts` (Note model + CRUD + tag
  normalization) with `tests/core/notes.test.ts` (20 tests, 100% coverage),
  opened **PR #4** (`Closes #1`) with labels `pi:review-needed, size:xs,
  type:feature, milestone:m1`; branch `task/1-notes-model`; CI passed. ✓
- Implemented issue #2 → `src/core/notesSearch.ts` (search + ANY-tag filter,
  pure/non-mutating) with `tests/core/notesSearch.test.ts` (18 tests, 100%
  coverage), opened **PR #5** (`Closes #2`); CI passed. ✓

### Review Engineer persona
Physically verified each PR (lint, tests, 100% coverage, build, diff scoped,
acceptance criteria, missing-test check) and **approved** (#4 and #5), adding
`pi:approved` + `pi:merge-ready` and removing `pi:review-needed`. ✓

### Merge
PR #4 and PR #5 were **squash-merged** with branch cleanup; issues #1/#2
auto-closed. ✓

### Completion
- `CI` workflow stayed **green on `main`** for every push (lint, tests with 100%
  core coverage, build). ✓
- **GitHub Pages** could not deploy because the repo is **private** (free plan
  requires public repos). Per plan, the harness created **issue #3** tagged
  `type:infra, pi:needs-human, pi:blocked` — the "blocked on human" path rather
  than an endless retry. ✓
- The PM marked the project **`done`** in `manifest.md` / `project-state.md`
  (M1 complete; the only unmet success criterion, the live Pages demo, is handed
  off to a human via issue #3) and committed+pushed. ✓

## 4. Stop path & one-project-per-machine

- `/loop-stop` (via `npm run stop`) wrote `.pi/state/stop`; the loop detected it on
  the next cycle and exited cleanly (`dispatch: stop (stop file present)`,
  `Loop stopped`, lock released). ✓
- A second `/loop-seed` while the pilot was active was **refused** with the
  one-project-per-machine message naming the active project. ✓

## 5. Success-criteria check (plan.md §28 M12)

| Criterion | Result |
|---|---|
| Repo created | ✅ `AntonLapshin/build-a-markdown-notes-app-with-tags-and-search` |
| Demo URL exists | ✅ in README |
| CI passes | ✅ green on every `main` push |
| Pages deploys (or blocked with needs-human issue) | ⚠️ blocked → issue #3 (`pi:needs-human`) |
| Issues created | ✅ #1, #2 (PM), #3 (Pages needs-human) |
| PRs reviewed | ✅ #4, #5 by Review Engineer |
| PRs merged | ✅ #4, #5 (squash) |
| Core coverage 100% / UI thin | ✅ |
| Project completes or stops safely | ✅ `manifest` status `done`; `/loop-stop` verified |

## 6. Findings for Milestone 13 (hardening)

The pilot surface several real-world gaps worth hardening in M13:

1. **Persona-session timeout.** `persona-runner.js` uses `timeout: 0`, so a
   persona that hangs (model provider stall / rate-limit) blocks the loop
   indefinitely. Recommend a configurable per-persona timeout (e.g.
   `limits.maxPersonaSeconds`) with retry/backoff and a failure counter. The
   pilot was stable only when persona sessions were bounded externally.
2. **Provider rate-limit / concurrency handling.** The pilot provider
   (`gonkaapi`/DeepSeek) intermittently returned `429 too many concurrent
   requests` and stalled on large persona contexts. Recommend retry-with-backoff
   on 429s and awareness of the provider's concurrency limits (M13 already
   plans rate-limit handling; this confirms the need).
3. **`.pi/runs/` was not git-ignored.** `templates/project/.gitignore.j2`
   ignored `.pi/local.json`, `.pi/logs/`, `.pi/state/` but **not** `.pi/runs/`,
   so run artifacts (context/stdout/stderr) could be committed. **Fixed in this
   milestone** (added `.pi/runs/` to the template and to the generated project).
4. **`npm run pages` depended on missing labels.** The needs-human issue creator
   needed labels `pi:needs-human`, `pi:blocked`, `type:infra`, which may not
   exist on a fresh repo; it failed until those labels were created. Recommend
   auto-creating the labels it uses.
5. **Single-account GitHub self-review limitation.** GitHub blocks formally
   approving your own PR via the review API; the Review Engineer worked around
   it with `pi:approved`/`pi:merge-ready` labels + PR/issue comments. Document
   this as an expected mode (or run with a separate reviewer account).
6. **Scaffold commit at seed.** The seed writes scaffold files to the working
   tree but does not commit/push the initial scaffold; the pilot committed it
   manually so CI would run. Consider committing the scaffold in `/loop-seed`.

## 7. Artifacts / proof

- Completed repo: `AntonLapshin/build-a-markdown-notes-app-with-tags-and-search`
  (PRs #4/#5 merged, issues #1/#2 closed, #3 `pi:needs-human`).
- `manifest.md`: `Status: done` (autonomous work), M1 `COMPLETE ✅`.
- Local logs under the generated project's `.pi/logs/` (runs/errors/summary)
  contain no secrets.
