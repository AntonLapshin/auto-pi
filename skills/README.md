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
- `budget-guard` (M13) — token/cost budget enforcement per plan §21: per-cycle,
  per-day, and per-cost limits plus the consecutive-failure limit and the
  per-persona token caps. Core logic in `skills/budget-guard/core.js`.
- `config` (M13) — config validation against `config.schema.json` and `/loop-sync-config`
  (recopy defaults preserving project values). Core logic in `skills/config/core.js`.
- `github` (M13) — resilient `gh` client with retry/backoff and rate-limit
  handling. Core logic in `skills/github/core.js`.
- `status` (M13) — the `/loop-status` report (active project, loop, last run,
  issues/PRs, budget). Core logic in `skills/status/core.js`.
