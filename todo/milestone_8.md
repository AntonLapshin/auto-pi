# Milestone 8: Engineer Persona

**Depends on:** Milestone 7
**Reference:** plan.md §17, §19, §22, §23, §28 "Milestone 8"

## Goal

Implement the Engineer persona: issue selection, implementation, testing, PR creation, review-comment addressing, and merging.

## Tasks

- [ ] Write `personas/engineer.md` persona prompt (plan.md §17, engineering guidelines §25.1).
- [ ] Implement Engineer context packer: issue body + comments, relevant files, test command, policy excerpts, PR review comments when addressing review (plan.md §21.1).
- [ ] Issue selection: pick a `pi:ready` issue not already in progress.
- [ ] Branch creation: `task/{issueNum}-{slug}`.
- [ ] Implementation rules enforcing plan.md §17.3/§19:
  - business logic in `src/core` (pure, no React)
  - view models in `src/ui/viewModels`
  - thin components in `src/ui/components`
  - adapters (storage, fetch) in `src/adapters`
  - core must not import React/Tailwind or access browser APIs
- [ ] Test runner integration: run `npm test` / coverage; every change adds tests.
- [ ] Changelog update with each PR.
- [ ] PR creation (plan.md §17.6):
  - branch `task/12-note-search`
  - commit message with `Closes #12`
  - PR title `Add ... (#12)`
  - PR body with Summary / Changes / Test Evidence / Checklist + `<!-- pi:pr issue=12 -->`
  - labels `pi:review-needed`, `size:*`, `milestone:*`, `type:*`
- [ ] Scope-too-large behavior (plan.md §17.5): stop, don't partial-implement, leave `PI-NOTE persona=PM reason=scope-too-large action=split`, label `pi:needs-pm` + `pi:blocked`.
- [ ] Review-comment handling: address review comments and update PR.
- [ ] Squash merge (plan.md §17.7):
  - conditions: approved, CI passes, no unresolved testable comments, no conflict, valid scope
  - `gh pr merge {n} --squash --delete-branch`
  - on failure log error, label `pi:merge-blocked` / `pi:conflict` / `pi:needs-human` on repeated failure

## Acceptance Criteria

- Engineer can implement an issue and open a PR.
- Engineer can address review comments.
- Engineer can squash-merge an approved PR.
- Core logic stays pure and covered; UI stays thin.
