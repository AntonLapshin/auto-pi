# Milestone 12: Pilot Project

**Depends on:** Milestones 0–11 (must all be functional)
**Reference:** plan.md §27, §28 "Milestone 12", §31

## Goal

Run a real end-to-end pilot to validate the whole harness, using the plan's canonical example.

## Tasks

- [ ] Set up a test GitHub account / token with `repo` + `workflow` scopes.
- [ ] Run workspace doctor:
  ```bash
  npm run doctor
  ```
  and confirm all prerequisites pass.
- [ ] Run the pilot:
  ```text
  /seed Build a markdown notes app with tags and search
  ```
- [ ] Verify the full lifecycle against plan.md §27 and §31:
  - clarification happens (or "use assumptions")
  - GitHub repo created under the configured account
  - scaffold is demoable and testable (`npm install`, `npm test`, `npm run build` pass)
  - README has the demo URL
  - `.pi/config.json` copied with correct values
  - CI runs on push and passes
  - Pages deploys (or is handled via `pi:needs-human` if blocked)
  - PM creates small issues
  - Engineer opens a PR with tests; Review Engineer verifies and approves; Engineer squashes and merges
  - core coverage stays at 100%; UI stays thin
  - logs written to `.pi/logs/` with no secrets
  - `/status` reflects active work
- [ ] Confirm stop path: run and verify `/stop {project}` stops the loop cleanly.
- [ ] Verify one-project-per-machine enforcement: `/seed` refuses while the pilot is active.
- [ ] Drive project to completion: all milestones done, manifest `status: done`, final issue, loop stops.

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
