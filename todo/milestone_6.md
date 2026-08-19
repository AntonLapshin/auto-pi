# Milestone 6: Loop Orchestrator

**Depends on:** Milestone 4, Milestone 5
**Reference:** plan.md §13, §14, §15, §28 "Milestone 6"

## Goal

Build the infinite autonomous loop: process lifecycle, lock/stop files, state scanner, dispatcher, and fresh persona runner.

## Tasks

### Loop process
- [ ] Implement `scripts/loop.js` and `extensions/loop/orchestrator.js` following plan.md §13.1 responsibilities:
  1. read `.pi/config.json`
  2. acquire local lock
  3. check active project
  4. check stop file
  5. scan GitHub state
  6. decide next persona
  7. build minimal context
  8. launch fresh Pi persona session
  9. log result
  10. sleep (`loop.intervalSeconds`)
  11. repeat
- [ ] Use PID + lock file under `.pi/state/loop.lock` (plan.md §13.2) — refuse to start a second loop for the same project.
- [ ] Implement stop file `.pi/state/stop` (plan.md §13.3) checked every cycle.
- [ ] Start via `nohup node scripts/loop.js > .pi/logs/loop.out 2>&1 &` during `/seed`.

### State scanner + dispatcher
- [ ] Implement `extensions/loop/state-scanner.js`: read open issues, open PRs, CI status, labels, budget usage from GitHub.
- [ ] Implement `extensions/loop/dispatcher.js` with the dispatch order from plan.md §15:
  1. stop file exists → stop
  2. budget exceeded → stop
  3. initiation needs human → wait
  4. PR has changes requested → Engineer
  5. PR approved + merge-ready → Engineer/Merge
  6. PR ready for review → Review Engineer
  7. open issues with unresolved PM notes → PM
  8. open ready issues → Engineer
  9. otherwise → PM

### Fresh persona runner
- [ ] Implement `extensions/loop/persona-runner.js` that launches a fresh Pi persona session:
  - use `pi run --fresh --persona ... --context <file> --run-id ...` if supported
  - otherwise emulate: new child process, unique run ID, no session persistence, context passed as file, output captured in run dir (plan.md §14, §29.3)

## Acceptance Criteria

- Loop runs only one project at a time (lock enforced).
- Loop can be stopped via stop file / `/stop`.
- Personas are selected per dispatch order.
- Each persona invocation starts a fresh session with no memory of prior conversations.
