# tests

Automated tests for the harness itself.

`npm test` runs `node --test tests/`. In the M0 skeleton there are no tests yet;
later milestones add unit tests here (e.g. for config copy, repo naming, state
scanner, dispatcher logic).

Current suites:
- `logging.test.js` — M10 logging & execution summary (run/error/summary JSONL,
  token accumulation, summary.md, redaction, rotation).
- `telegram.test.js` — M11 Telegram notifications (config/env resolution, message
  building, sendMessage via fake fetch, no-op when disabled/missing env, redaction).
- `pull.test.js` — `/loop-pull` (continue a project on another machine): repo-ref
  parsing, clone + configure + active-record orchestration, recreation of the
  git-ignored initiation marker, and switch/loop-recognition integration.

To add a test, create `tests/<name>.test.js` using the Node.js built-in test runner.
