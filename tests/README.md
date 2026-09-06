# Tests

Automated tests for the harness itself, using the Node.js built-in test
runner (`node:test`).

```bash
npm test                  # run all suites
node --test tests/loop.test.js   # run a single suite
```

## Suites (19)

| Suite | Covers |
|-------|--------|
| `agentic-clarify.test.js` | Agentic `/loop-seed` clarification: clarifier `pi` args, Question[] parsing/normalization, success + fallback paths |
| `agentic-manifest.test.js` | Post-clarification manifest generation: architect `pi` args, task building, JSON manifest parsing/normalization |
| `config.test.js` | M5 config copy: `config.default.json` → `{project}/.pi/config.json` + local-secrets scaffold |
| `deploy.test.js` | M4 Pages deploy helpers: run status, failure classification, `pi:needs-human` issue (fake `gh`, no network) |
| `engineer.test.js` | M8 Engineer context packer: target resolution, issue/PR context, labels, policy excerpts |
| `hardening.test.js` | M13 hardening: retry/backoff, rate limits, branch cleanup, conflict/attempt limits, budget guard, config validation, new commands |
| `logging.test.js` | M10 logging skill: run/error/summary JSONL, usage accumulation, `summary.md`, redaction, rotation |
| `loop.test.js` | M6 orchestrator: dispatcher order, state scanner, persona runner, lock/stop-file/active-project handling |
| `persona-retry.test.js` | M13 persona retry wrapper: retryability classification, retry settings, success/retry/give-up paths |
| `pm.test.js` | M7 PM context packer: manifest/state/changelog, issue/PR summaries, PM markers and labels |
| `provider-config.test.js` | `/loop-provider` config helper: read/persist provider+model while preserving other sections |
| `provider-resolution.test.js` | Provider/model resolution order: project config → `PI_*` env → pi user settings |
| `pull.test.js` | `/loop-pull`: repo-ref parsing, clone + configure + active-record, initiation-marker recreation |
| `review.test.js` | M9 Review Engineer context packer: PR/issue context, review settings, comment format and reasons |
| `scaffold.test.js` | M3 scaffold: template renderer, context builder, file set + identity injection |
| `seed-initial-commit.test.js` | `/loop-seed` initial commit+push step (real local git repo/bare remote) |
| `smoke.test.js` | M0 skeleton: config JSON parses, CLI stubs exit, `package.json` manifest well-formed |
| `state-scanner.test.js` | M6 state scanner: label → `review`-field mapping (`pi:changes-requested` / `pi:approved`) for self-authored PRs |
| `telegram.test.js` | M11 Telegram notifications: config/env resolution, no-op paths, message building, redaction |

## Adding a test

Create `tests/<name>.test.js` with the Node.js built-in runner (ESM —
the repo is `"type": "module"`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
```

Keep side effects hermetic: use temp dirs and fake `gh`/fetch runners —
never hit the network. Pure core logic (`skills/*/core.js`,
`extensions/loop/*.js`) should be directly unit-testable; keep CLI
(`scripts/`) and extension-index adapters thin and untested.
