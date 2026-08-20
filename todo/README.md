# Auto-Pi Milestone Breakdown

Breakdown of `plan.md` into implementable milestones, following the plan's Section 28 ("Implementation Milestones"). Each `todo/milestone_N.md` contains the concrete tasks and acceptance criteria for that milestone.

The dependency order forms a sequential build where earlier stages unlock later ones.

| # | Milestone | Depends on | Focus |
|---|-----------|------------|-------|
| 0 | Harness Skeleton | — | Repo structure, `package.json`, README, install via `pi install` |
| 1 | Environment Doctor | 0 | `/loop-doctor`: validate git/gh/node/npm/pi/token prerequisites |
| 2 | `/loop-seed` Initiation | 0, 1 | Clarification, repo naming, repo creation, workspace, one-project-per-machine |
| 3 | React/Tailwind Scaffold | 2 | Vite+TS+React+Tailwind+Vitest project generation, core/UI split, 100% core coverage |
| 4 | CI & Pages Deployment | 3 | GitHub Actions CI, Pages workflow, Vite base path, demo URL, Pages failure handling |
| 5 | Project Config Copy | 2 | Copy config.default.json → `.pi/config.json`, fill values, local secrets, gitignore |
| 6 | Loop Orchestrator | 4, 5 | Loop process, lock/stop files, state scanner, dispatcher, fresh persona runner |
| 7 | PM Persona | 6 | Context packer, issue creation, PM-note handling, done detection, project-state |
| 8 | Engineer Persona | 7 | Issue implementation, testing, PR creation, review addressing, squash merge |
| 9 | Review Engineer Persona | 8 | Physical-evidence review, missing-test detection, approve/request-changes flow |
| 10 | Logging & Summary | 6 | `runs.jsonl`, error logs, `summary.md`, token accounting, redaction |
| 11 | Telegram Integration | 7, 10 | Optional notifications for done/needs-human/budget events |
| 12 | Pilot Project | 0–11 | End-to-end `/loop-seed` pilot with full lifecycle validation |
| 13 | Hardening | 12 | Retry/backoff, rate limits, budgets, conflict handling, config validation, extra commands, docs |

## Execution Path Notes

- **Build order:** M0 → M1 → M2 → M3→ M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12 → M13.
- **Critical path to a working loop:** M0 → M2 → M3 → M4 → M5 → M6 (loop runs, then M7/M8/M9 make it autonomous).
- **Personas (M7, M8, M9)** are the core value: PM breaks work into small tested slices; Engineer implements + merges; Review Engineer enforces physically verifiable quality and 100% core coverage.
- **M12 (Pilot)** is the validation gate — the plan's §27 lifecycle example is the canonical run-through.
- **M13 (Hardening)** productionizes with budget limits, rate limits, retries, and the remaining `/loop-status`, `/loop-logs`, `/loop-resume`, `/loop-sync-config` commands.

## Cross-cutting requirements (apply throughout)

- One project per machine (M2+).
- Fresh persona sessions only — personas never remember prior conversations (M6).
- Core business logic in `src/core` with 100% coverage; UI stays a thin, dumb layer (M3, M7–M9).
- No secrets in logs, context, or PRs (M10, M13).
- `/loop-seed` and `/loop-stop` are the minimum required commands; `/loop-status`, `/loop-doctor`, `/loop-logs`, `/loop-resume`, `/loop-sync-config` strongly recommended (M1, M3, M13).
