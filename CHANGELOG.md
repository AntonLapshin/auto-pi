# Changelog

All notable changes to the auto-pi harness. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Per-turn LLM call ledger (`llm.jsonl`): one record per finished assistant
  message (turn) inside a persona's `pi --mode json` session
  (`appendLlmCall`/`readLlmCalls`/`extractLlmCalls` in
  `skills/logging/core.js`, written by `finalizePersonaRun` + per failed
  retry attempt), so provider performance is visible at true LLM granularity.
- `esp-status` v10 persona + LLM split: new `last10PersonaStatus` /
  `lastPersonaCallFinished` (whole persona runs, from `health.jsonl`) alongside
  `last10LlmStatus` / `lastLlmCallFinished` (now true per-turn LLM calls, from
  `llm.jsonl`); stuck watchdog + model fallback consider both ledgers.

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
- Persona LLM retry budget raised (`pi.maxRetries` 2 → 5,
  `pi.retryMaxDelayMs` 30s → 120s) so transient provider degradation
  (e.g. Gonka upstream timeouts / 429 overload) is absorbed in-run
  instead of burning a loop cycle per blip.
- Persona LLM retries now CONTINUE the same pi session (`--session-id <runId>`
  + short "continue" message) instead of restarting from scratch, so a 429 /
  upstream timeout near the end of a persona run resumes where it left off;
  after `pi.maxRetries` (5) failed continues the next dispatch starts a new
  session as before.

### Fixed

- `esp-status` stuck false-positives: `stuck` no longer fires while the
  persona's `pi` child is alive (an LLM call in flight — health/events are
  only written when a call finishes or retries), failed LLM calls count as
  activity, and a NaN-poisoned `Math.max` (one missing signal disabled the
  whole watchdog) is fixed. New additive `llmActive` field marks an in-flight
  call so a stale `lastLlmCallFinished` reads as "working…", not hung.
- `esp-status` "no action yet" despite a fresh PR: bash tool-call commands
  (`cd <ws> && git push …`, `gh pr create …`) are now kept from the pi JSON
  stream and `parseGitCommands` splits shell chains, so commit/push/PR events
  are emitted; `pr.created` renders the explicit PR number ("opened PR #101").
- `redactSecrets` no longer scrubs hyphenated run IDs: the shield now covers
  compound personas (`review-engineer-…`), which were redacted to
  `[REDACTED]`, breaking run correlation in every ledger.

## [0.1.0] — 2026-08-27

First working harness: Pi extension package with providers (`joingonka`,
`gonkaapi`), 11 slash commands + fallback CLIs, three personas (PM,
Engineer, Review Engineer) running fresh sessions in an autonomous loop,
React/Tailwind/TS scaffold with CI + Pages deploy, structured JSONL ledgers
with redaction, optional Telegram notifications, config defaults + schema
validation, UI monitor, and 19 backend test suites. Validated end-to-end by
the M12 pilot (`docs/pilot-report.md`) and hardened per M13
(`todo/milestone_13.md`).
