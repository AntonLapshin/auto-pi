# Documentation

User and operator documentation for the auto-pi harness.

- `installation.md` — prerequisites and `pi install`
- `architecture.md` — harness map (extensions ↔ scripts ↔ skills ↔ loop ↔ ledgers ↔ UI), one-active-project invariant, persona model, label glossary
- `commands.md` — all 11 slash commands (`/loop-seed`, `/loop-pull`, `/loop-stop`, `/loop-restart`, `/loop-switch`, `/loop-status`, `/loop-logs`, `/loop-resume`, `/loop-sync-config`, `/loop-provider`, `/loop-doctor`) plus `/loop`
- `configuration.md` — `config.json` reference + config validation / `/loop-sync-config`
- `personas.md` — PM, Engineer, Review Engineer + context packs
- `github-pages.md` — Pages deployment + health check (`npm run pages` / `scripts/pages.js`)
- `github-token.md` — token scopes (`repo`, `workflow`) and `gh auth login`
- `telegram.md` — optional Telegram lifecycle notifications (canonical config table; `npm run notify` / `scripts/notify.js`)
- `troubleshooting.md` — common issues and fixes (canonical budget/conflict/retry reference)
- `ui.md` — UI monitor operator guide (API table, ledger schemas, dev vs prod serving)
- `pilot-report.md` — the M12 end-to-end pilot report (plus §6 findings that drove M13 hardening)

See the top-level `README.md` for installation and prerequisite guidance; see
`docs/github-token.md` for GitHub token setup.
