# Milestone 12: Pilot Project

**Depends on:** Milestones 0–11 (must all be functional)
**Reference:** plan.md §27, §28 "Milestone 12", §31

## Goal

Run a real end-to-end pilot to validate the whole harness, using the plan's canonical example.

## Tasks

- [x] Set up a test GitHub account / token with `repo` + `workflow` scopes.
- [x] Run workspace doctor:
  ```bash
  npm run doctor
  ```
  and confirm all prerequisites pass.
- [x] Run the pilot:
  ```text
  /seed Build a markdown notes app with tags and search
  ```
- [x] Verify the full lifecycle against plan.md §27 and §31:
  - [x] clarification happens (or "use assumptions")
  - [x] GitHub repo created under the configured account
  - [x] scaffold is demoable and testable (`npm install`, `npm test`, `npm run build` pass)
  - [x] README has the demo URL
  - [x] `.pi/config.json` copied with correct values
  - [x] CI runs on push and passes
  - [x] Pages deploys (or is handled via `pi:needs-human` if blocked)
  - [x] PM creates small issues
  - [x] Engineer opens a PR with tests; Review Engineer verifies and approves; Engineer squashes and merges
  - [x] core coverage stays at 100%; UI stays thin
  - [x] logs written to `.pi/logs/` with no secrets
  - [x] `/status` reflects active work (M13; loop `status`/summary reflects it)
- [x] Confirm stop path: run and verify `/stop {project}` stops the loop cleanly.
- [x] Verify one-project-per-machine enforcement: `/seed` refuses while the pilot is active.
- [x] Drive project to completion: all milestones done, manifest `status: done`, final issue, loop stops.

> **Pilot outcome:** ran the canonical example end-to-end on `AntonLapshin` — see
> [`docs/pilot-report.md`](../docs/pilot-report.md). Repo created; PM filed
> issues #1/#2; Engineer opened PRs #4/#5 (tests, 100% core coverage); Review
> Engineer approved; Engineer squash-merged; CI green on `main`; local logs
> clean of secrets; `/stop` and one-project-per-machine verified; project marked
> `status: done`. GitHub Pages was blocked for the private repo and handled via
> `pi:needs-human` issue #3 (documented expected outcome). The `/status` command
> itself is implemented in M13 (it remains a stub). M13 hardening items found by
> this pilot are listed in `docs/pilot-report.md` §6.

## Success Criteria (plan.md §28 M12)

- repo created
- demo URL exists
- CI passes
- Pages deploys (or blocked with needs-human issue)
- issues created
- PRs reviewed
- PRs merged
- core coverage remains 100%
- project completes or stops safely
