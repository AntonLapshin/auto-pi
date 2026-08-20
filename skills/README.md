# skills

Pi skills packaged with the harness. Skills are `SKILL.md` folders or top-level `.md`
files that pi auto-discovers from this directory (loaded via the `pi` block in
`package.json`).

Implemented skills:
- `logging` (M10) — local run/error/summary logging and token-usage accounting.
  Core logic in `skills/logging/core.js` (plain JS, shared with the loop).

Planned skills (implemented in later milestones):
- `budget-guard` (M13) — token/cost budget enforcement per plan §21.

This directory ships empty in the skeleton; it is registered in `package.json`
so it is ready to receive skills.
