# Milestone 8: Engineer Persona

**Depends on:** Milestone 7
**Reference:** plan.md §17, §19, §22, §23, §28 "Milestone 8"

## Goal

Implement the Engineer persona: issue selection, implementation, testing, PR creation, review-comment addressing, and merging.

## Tasks

- [x] Write `personas/engineer.md` persona prompt (plan.md §17, engineering guidelines §25.1).
- [x] Implement Engineer context packer: issue body + comments, relevant files, test command, policy excerpts, PR review comments when addressing review (plan.md §21.1).
- [x] Issue selection: pick a `pi:ready` issue not already in progress.
- [x] Branch creation: `task/{issueNum}-{slug}`.
- [x] Implementation rules enforcing plan.md §17.3/§19:
  - business logic in `src/core` (pure, no React)
  - view models in `src/ui/viewModels`
  - thin components in `src/ui/components`
  - adapters (storage, fetch) in `src/adapters`
  - core must not import React/Tailwind or access browser APIs
- [x] Test runner integration: run `npm test` / coverage; every change adds tests.
- [x] Changelog update with each PR.
- [x] PR creation (plan.md §17.6):
  - branch `task/12-note-search`
  - commit message with `Closes #12`
  - PR title `Add ... (#12)`
  - PR body with Summary / Changes / Test Evidence / Checklist + `<!-- pi:pr issue=12 -->`
  - labels `pi:review-needed`, `size:*`, `milestone:*`, `type:*`
- [x] Scope-too-large behavior (plan.md §17.5): stop, don't partial-implement, leave `PI-NOTE persona=PM reason=scope-too-large action=split`, label `pi:needs-pm` + `pi:blocked`.
- [x] Review-comment handling: address review comments and update PR.
- [x] Squash merge (plan.md §17.7):
  - conditions: approved, CI passes, no unresolved testable comments, no conflict, valid scope
  - `gh pr merge {n} --squash --delete-branch`
  - on failure log error, label `pi:merge-blocked` / `pi:conflict` / `pi:needs-human` on repeated failure

## Acceptance Criteria

- [x] Engineer can implement an issue and open a PR.
- [x] Engineer can address review comments.
- [x] Engineer can squash-merge an approved PR.
- [x] Core logic stays pure and covered; UI stays thin.
