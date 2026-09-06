# Changelog

All notable changes to the auto-pi harness. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `docs/architecture.md`: harness map, one-active-project invariant,
  fresh-session persona model, single label glossary (`pi:*`, `type:*`,
  `size:*`, `milestone:*`, `priority:*`, `PI-NOTE`/`PI-REVIEW`/`PI-HUMAN`
  markers), `scripts/<cmd>.js` ↔ `/loop-<cmd>` mapping table.
- `docs/ui.md`: UI monitor operator guide (extracted from `ui/README.md`).
- `CONTRIBUTING.md`: dev setup, checks, commit style, how to add a
  command/skill/persona/policy/template, PR checklist.

### Changed

- Docs overhaul (Phase B): stale `plan.md` references rewritten to the
  historical original plan with canonical pointers (`README.md`, `docs/`);
  `tests/README.md` lists all 19 suites; `docs/installation.md` verify-list
  covers all 11 commands; `todo/milestone_0.md` (8 tasks) and
  `todo/milestone_13.md` (17 tasks) marked complete and verified;
  `docs/pilot-report.md` §4 + `todo/milestone_12.md` corrected to the
  stop-then-seed contract; `README.md` prereqs and `/loop-pull` sections
  shortened to summaries linking at canonical pages; `docs/configuration.md`
  telegram table replaced by a link to `docs/telegram.md`; doc H1s
  title-cased (`docs/github-token.md` → GitHub Token, `docs/README.md` →
  Documentation); size-label casing unified to lowercase (`size:xs`).
- `ui/README.md` trimmed to a summary + link to `docs/ui.md`.

## [0.1.0] — 2026-08-27

First working harness: Pi extension package with providers (`joingonka`,
`gonkaapi`), 11 slash commands + fallback CLIs, three personas (PM,
Engineer, Review Engineer) running fresh sessions in an autonomous loop,
React/Tailwind/TS scaffold with CI + Pages deploy, structured JSONL ledgers
with redaction, optional Telegram notifications, config defaults + schema
validation, UI monitor, and 19 backend test suites. Validated end-to-end by
the M12 pilot (`docs/pilot-report.md`) and hardened per M13
(`todo/milestone_13.md`).
