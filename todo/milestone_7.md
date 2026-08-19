# Milestone 7: PM Persona

**Depends on:** Milestone 6
**Reference:** plan.md §16, §23, §25, §28 "Milestone 7"

## Goal

Implement the PM persona: context packing, issue creation, PM-note handling, done detection, and project-state management.

## Tasks

- [ ] Write `personas/pm.md` persona prompt (plan.md §16, §25 policies).
- [ ] Implement PM context packer that sends only: manifest, project-state, changelog, open issue summaries, open PR summaries, recent merged PR summaries, policy excerpts (plan.md §21.1 context rules).
- [ ] Implement PM logic:
  - scan for open issues with PM notes (`PI-NOTE persona=PM`); if present, address/split/update state and resolve notes
  - if open issues exist without PM notes → skip turn
  - if no open issues → update `project-state.md`, decide done, else create small batch of issues (`limits.maxBatchIssues`, default 3)
- [ ] Issue-creation rules:
  - small enough for one Engineer session (`size:XS`/`size:S`)
  - label per plan.md §23.1 (type, size, milestone)
  - UI issues require core + view-model + thin component structure and tested logic (plan.md §16.4)
  - milestone splitting for large work (plan.md §16.3)
  - issue idempotency (avoid duplicate issues, use `<!-- pi:issue-id M#-T### -->` markers)
- [ ] PM-note resolution: implement `PI-NOTE-RESOLVED` markers.
- [ ] Done detection (plan.md §16.5): all milestones complete, no open issues/PRs, CI passes, tests pass, core coverage 100%, build succeeds, Pages deployed or explicitly blocked, README demo URL present, changelog + project-state current.
- [ ] On done: update manifest to `status: done` + `completed_at`, commit/push, create final "Project completed" issue, write local completion state, trigger Telegram if enabled, stop loop.

## Acceptance Criteria

- PM skips when open issues exist.
- PM handles PM notes and resolves them.
- PM creates small, properly-labeled issues.
- PM can mark a project done only when all done-definition conditions hold.
