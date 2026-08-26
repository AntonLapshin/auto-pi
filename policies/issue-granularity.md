# Issue Granularity

How the PM breaks work into issues so every slice fits a single Engineer session
while the **set** of issues fully covers the whole task or milestone (plan
§16.3, §23.1).

## Rules

- **Create only XS/S issues.** Each issue must be small enough to implement with
  tests and a passing build in one fresh Engineer session.
- **Cover the whole task — never be minimal.** Small issues are about dividing
  labour, not shrinking scope. Create **as many issues as the task needs** so
  the full task/milestone is implemented end-to-end, including edge cases,
  error states, UI polish, and tests. If a goal spans many sessions, define a
  milestone and plan subsequent slices on later PM turns.
- **Take over and elaborate manually created issues.** A fresh unlabeled issue
  is a task to fully plan: read it, the repo, and `manifest.md`, understand the
  intent, and break it into every issue needed to complete it — never trim it to
  a POC. Finish each slice; later PM turns plan the remaining slices.
- **Label every issue** with a size (`size:xs` / `size:s`), a type
  (`type:feature` / `type:bug` / `type:refactor` / `type:test` / `type:infra`),
  a milestone (`milestone:{slug}`), and a **priority** (`priority:p1` /
  `priority:p2` / `priority:p3`) so the Engineer knows the build order.
- **Add acceptance criteria** as a `- [ ]` checklist in the issue body so the
  Engineer and Review Engineer can verify completion.
- **Keep issues idempotent** with the `<!-- pi:issue-id M{N}-T{N} -->` marker so
  the PM does not re-create the same issue on later cycles.
- **When an issue is too large** (the Engineer stops with
  `PI-NOTE persona=PM reason=scope-too-large action=split`), the PM splits it
  into smaller XS/S issues and resolves the note.

## Priorities

Every issue carries a priority label so the Engineer implements them in the
right order and always knows what to pick next (`p1` first, then `p2`, then
`p3`):

- `priority:p1` — foundational / highest value / do-first (core logic, blocking
dependencies).
- `priority:p2` — follow-on work that builds on `p1`.
- `priority:p3` — polish / nice-to-have.

## Sizes

- `size:xs` — a few lines of core + tests; fits comfortably in one session.
- `size:s` — a small feature slice; still fits in one session.
- `size:m` / `size:l` — too large for one session; split before dispatch.
