# skills

Pi skills packaged with the harness. Skills are `SKILL.md` folders or top-level `.md`
files that pi auto-discovers from this directory (loaded via the `pi` block in
`package.json`).

Implemented skills:
- `logging` (M10) — local run/error/summary logging and token-usage accounting.
  Core logic in `skills/logging/core.js` (plain JS, shared with the loop).
- `telegram-notify` (M11) — optional env-driven Telegram notifications for key
  lifecycle events (project done, needs-human, loop stopped). Core logic in
  `skills/telegram-notify/core.js` (plain JS, shared with the loop and the
  `scripts/notify.js` fallback CLI).

Planned skills (implemented in later milestones):
- `budget-guard` (M13) — token/cost budget enforcement per plan §21.

This directory ships empty in the skeleton; it is registered in `package.json`
so it is ready to receive skills.
