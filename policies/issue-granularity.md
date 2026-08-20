# Issue Granularity

How the PM breaks work into issues so every slice fits a single Engineer session
(plan §16.3, §23.1).

## Rules

- **Create only XS/S issues.** Each issue must be small enough to implement with
  tests and a passing build in one fresh Engineer session. Larger work is split
  into a milestone and broken down further.
- **Label every issue** with a size (`size:xs` / `size:s`), a type
  (`type:feature` / `type:bug` / `type:refactor` / `type:test` / `type:infra`),
  and a milestone (`milestone:{slug}`).
- **Add acceptance criteria** as a `- [ ]` checklist in the issue body so the
  Engineer and Review Engineer can verify completion.
- **Keep issues idempotent** with the `<!-- pi:issue-id M{N}-T{N} -->` marker so
  the PM does not re-create the same issue on later cycles.
- **When an issue is too large** (the Engineer stops with
  `PI-NOTE persona=PM reason=scope-too-large action=split`), the PM splits it
  into smaller XS/S issues and resolves the note.

## Sizes

- `size:xs` — a few lines of core + tests; fits comfortably in one session.
- `size:s` — a small feature slice; still fits in one session.
- `size:m` / `size:l` — too large for one session; split before dispatch.
