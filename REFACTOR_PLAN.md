# auto-pi — Refactoring, Cleanup & Growth Plan

> Audit date: 2026-09-05 · branch `main` (clean, 46 commits, last `b210a21` 2026-08-27) ·
> scope: `config/ docs/ extensions/ personas/ policies/ scripts/ skills/ templates/ tests/ ui/ todo/`
> Goal: turn auto-pi from a working POC harness into a production-grade,
> product-leading autonomous engineering team — one that **leads the project and
> expands it rather than stopping at minimal implementation**.

---

## 0. Current-state assessment (what's good / what's POC-grade)

**Good foundations (keep):**

- Clear separation: thin `extensions/*.index.ts` + `scripts/*.js` CLIs both delegating to `extensions/*/core.js`, `extensions/loop/orchestrator.js`, `skills/*/core.js`.
- 19 backend test suites (~5.6k LOC, `node:test`), esp. `loop.test.js` (954 lines). Zero literal `TODO/FIXME/HACK`.
- Centralized defaults in `config/config.default.json` + JSON-Schema validation (M5/M13).
- Deterministic structured ledgers (M10: `runs/errors/summary/usage/events/health.jsonl`) consumed by UI monitor.
- Persona system (PM / Engineer / Review-Engineer) with policy excerpts in context packs.

**POC-grade gaps (this plan fixes):**

| Area | Finding |
|---|---|
| Quality gates | **No lint, no format, no typecheck, no coverage, no CI** — root and `ui/` have zero `eslint/prettier/vitest` config, no `.github/workflows/`. Yet `policies/done-definition.md`, `testing-policy.md`, 47 code references mandate `npm run lint + test + coverage + build`. Templates scaffold strict ESLint for *generated* projects but the harness doesn't dogfood it. |
| UI backend | `ui/server/server.js` (338 lines, single file, `node:http`): no `--port` parsing (ignores documented flag), binds `0.0.0.0` + `CORS *` + no auth, no static `dist/` serving despite `ui/README.md` claiming "production-style single server", unbounded JSONL reads into memory, no `limit` clamp, no ETag/cache/streaming, `existsSync` in async path, `catch → 500 err.message` leaks internals, hardcoded `CURRENT_PROJECT_FILE` (untestable). |
| UI frontend | No error boundary, no distinction `404 No active project` vs "backend down", 4 independent pollers (waterfall, no `AbortController`, no backoff, no `visibilitychange` pause), fixed 2-col grid (broken on mobile), `key={i}` keys, hardcoded `/api` base, full-page `Loading…` flash, footer leaks absolute workspace path, `SummaryPanel.tsx` re-exports `fmtDuration` solely to silence `noUnusedLocals`. |
| Tests | `tests/README.md` stale ("M0 skeleton, no tests yet" — actually 19 suites). Gaps: `budget-guard`, `status`, `sync-config`, `dispatcher`/`reliability`/`persona-runner` (only partial `persona-retry`), all `notify/pages/restart/switch/resume/stop/logs` CLIs, provider registration (`gonkaapi/joingonka/harness`), zero UI/server API-contract tests. `npm test = node --test` with no coverage thresholds while generated projects enforce 100% core coverage. |
| Error handling | Three competing conventions (`{ok,error\|message}`, `{ok,error,report}`, `{ok,stdout,stderr,exitCode}`); exit-code mapping inconsistent (`notify.js` always 0, `restart.js` 3-way, `pages.js` 5 exit sites); ~10 silent `.catch(()=>{})` (rotation, lock release, telegram notify) — failures invisible, should `console.warn` or append to `errors.jsonl`. `/loop-logs` CLI exits 1 on missing logs while slash command returns info exit 0 — undocumented. |
| Duplication | `scripts/logs.js` ↔ `harness.ts /loop-logs` duplicate tail logic instead of shared helper; same for `resume`. `gonkaapi.ts` vs `joingonka.ts` share ~80% boilerplate (model id, `reasoning_effort:max`, costs). `persona-runner.js:445/458` hardcodes `600000/3600000` fallbacks duplicating `config.default.json`. Retry defaults diverge (`loop` 2/5s/30s vs `github` skill 3/1s/30s) with no documented rationale. |
| Docs | Stale: `pilot-report.md §4` + `todo/milestone_12.md` say second `/loop-seed` is "refused" — current contract is stop-then-seed. `todo/M0` (8 tasks) + `todo/M13` (17 tasks) all unchecked despite implementation (`eb97869 Implement M13 hardening` + follow-ups). `package.json pi.extensions` omits `pull` + `harness.ts` (works only via `./extensions` auto-discovery). All `todo/*.md` reference missing `plan.md`. Duplication: README prereqs ≈ `installation.md`; telegram tables in 2 places; pull flow in 2 places. Missing: architecture, CONTRIBUTING/development, CHANGELOG, UI-monitor docs page, label glossary. Inconsistent naming (`# docs/github-token` vs `# Commands`, `size:xs` vs `size:XS`, 7+ `pi:*` labels with no single glossary, example repos `ape-kingdom` vs `build-a-markdown-notes-app`). |
| Product behavior | Loop/PM stops at minimal implementation (recent commits `dfe73da`, `0ad836b` started fixing: "never skip manifest scope", "cover tasks fully"). No roadmap ownership, no scope-expansion, no quality-gate enforcement beyond happy path, no UI controls (pause/resume/switch/budget from dashboard). |

---

## 1. Guiding principles

1. **auto-pi leads, not just executes.** PM owns roadmap (`manifest.md` + `project-state.md` + `CHANGELOG.md`), proposes scope expansions, keeps a prioritized backlog, never declares done on a skeleton.
2. **Build a product, not a POC.** Every harness change ships with lint + typecheck + tests + docs. UI is a real operator console, not a demo page.
3. **One source of truth.** Config defaults live in `config.default.json`; retry/timeout/label/port constants imported, never re-hardcoded. Docs have one canonical page per topic, others link.
4. **Thin adapters, tested core.** Follow the harness's own `engineering-guidelines.md`: extract pure testable core from `scripts/`/`server.js`/context-packers; keep CLIs/server/components thin.
5. **Fail loudly, redact secrets.** No silent `.catch(()=>{})`. All failures land in `errors.jsonl` + `stderr` with redaction (`skills/logging` `redactSecrets()`).

---

## 2. Phase A — Fixes & cleanup (P0, ~2–3 days)

### A1. Remove dead code & stale artifacts

- [ ] Delete `scripts/stub.js` (M0 skeleton, zero importers; only self + README mention). Remove its row from `scripts/README.md`.
- [ ] Fix `package.json` `pi.extensions`: add `"./extensions/pull"` explicitly (currently relies on `./extensions` auto-discovery; `extensions/README.md` table lists `pull/ —` with no milestone — set to M6/M13). Verify `/loop-seed /loop-pull /loop-stop /loop-status /loop-doctor` still register after change.
- [ ] `ui/src/components/SummaryPanel.tsx:3,79`: remove unused `fmtDuration` import + `export {fmtDuration}` hack.
- [ ] `ui/src/components/HealthPanel.tsx:73`: remove redundant `.slice(0,6)` (server already caps at 10).
- [ ] Verify `templates/project/src/ui/viewModels/useProjectInfo.ts.j2` — empty/unlisted template; either implement or delete. Add scaffold test asserting every `.j2` renders (catches orphans).
- [ ] `ui/dist/` is gitignored but present on disk (stale Aug-22 build): `rm -rf ui/dist && npm run ui:build` to confirm reproducibility, never rely on committed artifact.
- [ ] Replace hardcoded example `AntonLapshin/ape-kingdom` in `extensions/pull/index.ts:9,42`, `extensions/pull/core.js:272`, `scripts/pull.js:9,34` with `owner/repo` placeholder.
- [ ] `.gitignore`: add explicit `.pi/` + `~/.auto-pi/` note at repo level (current comment claims coverage but has no rule; generated-project gitignore covers only generated repos).

Acceptance: `rg -n "stub|ape-kingdom|fmtDuration" --glob '!package-lock.json' --glob '!.git/'` returns only historical docs or nothing; `pi` loads all 11 commands.

### A2. Standardize error handling & exit codes

- [ ] Introduce `extensions/loop/result.js` (or `skills/logging/errors.js`): single `okResult()/failResult()` shape `{ok, code, message, details?}`; migrate `orchestrator/seed/pull/status/github-skill` to it.
- [ ] Standardize CLI exit codes: `0 ok · 1 operational failure · 2 usage/config error`. Fix outliers: document `notify.js` always-0 no-op explicitly; align `restart.js` timeout (currently 2) and `pages.js` (5 exit sites) to the scheme; document `/loop-logs` missing-logs divergence (slash → info, CLI → exit 1) in `docs/commands.md`.
- [ ] Replace all silent `.catch(()=>{})` (`skills/logging/core.js:187-188`, `extensions/loop/orchestrator.js:733,748,760,809,815,837,938`, `extensions/harness.ts:112-114,127-129`, `extensions/seed/core.js:197`) with `warnOrLogError(err, context)` that `console.warn`s + appends redacted entry to `errors.jsonl`.
- [ ] Unify log prefixes: `[auto-pi:<cmd>]` on stderr with `err.stack`, user-facing `notify()` with `err.message` only (keep the separation, make it consistent across `doctor/status/logs`).

### A3. Centralize constants & kill duplication

- [ ] Extract `readTailLog(workspace, tail=40)` + `resumeLoop(workspace)` shared helpers (e.g. `skills/logging/core.js` or `extensions/loop/log-helpers.js`); make `scripts/logs.js` + `harness.ts /loop-logs` and `scripts/resume.js` + `harness.ts /loop-resume` both delegate (same pattern as `stop/restart/switch` → `orchestrator.js`).
- [ ] `persona-runner.js:445/458`: import `personaInactivityMs/personaTimeoutMs` from `config.default.json` instead of hardcoded `600000/3600000`.
- [ ] Extract provider factory `extensions/providers.js`: `defineProvider({id, baseUrl, models, costs})` — `gonkaapi.ts` + `joingonka.ts` become ~10-line declarations. Fixes spaces-vs-tabs `reasoning_effort` inconsistency.
- [ ] Document retry asymmetry: loop-persona retry (2/5s/30s) vs `gh` skill retry (3/1s/30s) — add rationale comment + row in `docs/troubleshooting.md`.
- [ ] Move `doctor/core.js:248` remediation string (mentions `joingonka/gonkaapi + /model`) to a constant derived from registered providers.

---

## 3. Phase B — Documentation overhaul (P0, ~2 days, parallelizable with A)

### B1. Fix stale / contradictory docs

- [ ] `docs/pilot-report.md §4` + `todo/milestone_12.md`: replace "second `/loop-seed` refused" with current stop-then-seed + `/loop-switch` back semantics (match `README.md:68`, `docs/commands.md:27`).
- [ ] `tests/README.md`: rewrite — list all 19 suites with one-line purpose (generate from `tests/*.test.js` headers), document `npm test` + coverage (after Phase C), how to add a test.
- [ ] `todo/milestone_0.md`: check all 8 boxes (structure exists). `todo/milestone_13.md`: audit 17 items against `eb97869` + follow-ups, check implemented ones, leave genuinely-open ones for Phase D.
- [ ] `docs/README.md`: add missing index entries (`/loop-switch`, `/loop-pull`, `/loop-restart`, `/loop-provider`, UI monitor, `pages`/`notify` CLIs). Fix "pilot-report = M12 + M13 notes" → "M12 pilot + findings-for-M13".
- [ ] `installation.md:38`: verify-list must include all 11 commands. `todo/README.md:38`: update "seed/stop minimum" → current 11-command surface.
- [ ] Resolve dangling `plan.md §…` refs in all `todo/*.md`: either restore `plan.md` or rewrite refs to point at `README/docs/*`.

### B2. Deduplicate — one canonical page per topic

- [ ] Prereqs: canonical `docs/installation.md`, `README.md` keeps 5-line summary + link.
- [ ] Telegram config table: canonical `docs/telegram.md`, `docs/configuration.md` links.
- [ ] `/loop-pull` flow: canonical `docs/commands.md#loop-pull`, `README.md` keeps short version + link.
- [ ] Budget/conflict handling: canonical `docs/troubleshooting.md`, `configuration.md` links to defaults table.

### B3. Write missing docs

- [ ] `docs/architecture.md` (new): harness map — `extensions/ ↔ scripts/ ↔ skills/ ↔ loop (scanner/dispatcher/contexts/runner) ↔ ledgers ↔ UI`; one-active-project invariant; fresh-session persona model; label state machine (see B4).
- [ ] `docs/ui.md` (new): move monitor details out of `ui/README.md` + top-README paragraph; document API table, ledger schemas link, dev vs prod serving, `--port`/bind/auth flags (after Phase C server fix).
- [ ] `CONTRIBUTING.md` (new): dev setup, `npm run lint/typecheck/test/coverage/build`, commit style, how to add command/skill/persona/policy/template, PR checklist (links `policies/*`).
- [ ] `CHANGELOG.md` (new, Keep-a-Changelog): seed with `0.1.0` + this plan's phases.
- [ ] Label glossary (new section in `architecture.md` or `commands.md`): single table for `pi:ready/review-needed/approved/merge-ready/changes-requested/blocked/needs-human/conflict/needs-pm`, `type:infra`, `size:xs/s` (fix `xs` vs `XS` casing), `PI-HUMAN` marker.
- [ ] Naming pass: title-case all `docs/*.md` H1s; unify examples to one demo repo name; unify `scripts/<cmd>.js ↔ /loop-<cmd>` mapping table (note bare `/loop` exception).

---

## 4. Phase C — Production-quality harness (P1, ~1–2 weeks)

### C1. Lint / format / typecheck / CI (highest leverage)

- [ ] Root: add `eslint` (flat config, `eslint.config.js`) + `prettier` + scripts: `lint`, `lint:fix`, `format`, `format:check`, `typecheck` (if TS added) — dogfood the strictness templates impose on generated projects.
- [ ] `ui/`: add `eslint + prettier + vitest (+ @testing-library/react)` and scripts `lint/typecheck/test/coverage`. Extend `ui/tsconfig.json` `include` to `src`, `server/`, `vite.config.ts` (or split `tsconfig.server.json`).
- [ ] Root coverage: `node --test --experimental-test-coverage` or `c8`; set initial thresholds (e.g. 70% lines, ratchet to 80%+), add `test:coverage` script. Harness must converge toward the 100%-core bar it demands of generated projects (at least for `skills/*/core.js`, `orchestrator`, `dispatcher`, `state-scanner`).
- [ ] CI: add `.github/workflows/ci.yml` (node 18 + 20 matrix: `lint + format:check + test + coverage + ui build`). Add branch protection expectation to `CONTRIBUTING.md`. This closes the "47 lint references, zero implementation" gap.

### C2. Harden `ui/server/server.js`

- [ ] Parse `process.argv --port N` + `--host` (default `127.0.0.1`, opt-in `0.0.0.0`); keep `PORT/HOST` env override. Document in `ui/README.md`.
- [ ] Bind localhost by default; replace `CORS *` with same-origin (or configurable allowlist); add optional `UI_TOKEN` bearer check for non-local binds.
- [ ] Implement the promised static serving: `GET / → ui/dist` + `/api/*` JSON; unknown routes → SPA fallback or JSON 404 (not bare `404 Unknown endpoint`).
- [ ] Clamp `?limit=` (e.g. `1..1000`, default 200/100/50 per endpoint); stream or tail-read JSONL (don't load full files); add `ETag`/`Cache-Control: no-store` for logs, short cache for `healthz`.
- [ ] Error hygiene: never leak `err.message` internals raw — `sendError(500, 'internal', requestId)` + server-side log; validate inputs; add request log + graceful shutdown (`SIGINT/SIGTERM`).
- [ ] Testability: extract `createServer({currentProjectFile, logDir})` pure factory; add `tests/ui-server.test.js` covering all 8 endpoints, limit clamping, 404-no-project vs 500, static serving.

### C3. Graduate UI frontend from demo to console

- [ ] Add `ErrorBoundary` per panel (one crash ≠ dead app) + distinct empty states: "backend down" vs "no active project" vs "no runs yet".
- [ ] Replace 4 independent `usePoll`s with single `useDashboardPoll` hook: `AbortController`, exponential backoff on error, `visibilitychange` pause, `?limit` tuning. Add hook tests.
- [ ] Responsive: `.dashboard-grid` → `1col <768px`; fix `RunsTable`/`ErrorsPanel` keys (`runId`, error hash — never index); env-overridable API base (`VITE_API_BASE`); replace full-page `Loading…` with skeleton panels; stop leaking absolute workspace path (show `owner/repo` + basename, full path behind toggle).
- [ ] A11y/polish: label refresh button, `scope` on table headers, contrast pass, drop `🎉` emoji, replace fragile `d.hour.slice(11)` with real date util (test in `format.test.ts`), replace `eventStyle` if-chain with lookup map.
- [ ] Component tests: `format`, `usePoll`, `Header/SummaryPanel/HealthPanel/Timeline/RunsTable/ErrorsPanel` via vitest.

### C4. Close backend test gaps

- [ ] New suites: `budget-guard.test.js`, `status.test.js` (`skills/status/core.js` 177 lines currently untested), `sync-config` (direct, not via `config.test.js` indirection), `dispatcher` edge cases (one-PR gate, zero-issue WAIT zero-cost), `reliability` backoff/jitter math, `provider-env`, `notify/pages/restart/switch/resume/stop/logs` CLI happy+error paths, provider registration smoke (`gonkaapi/joingonka/harness` register without throw).
- [ ] Scaffold: assert every `templates/**/*.j2` renders + `base:/{repo}/` injection + private-repo warning path.
- [ ] Update `tests/README.md` (B1) as suites land; enforce `npm run test:coverage` in CI.

---

## 5. Phase D — Make auto-pi *lead* the project (P1, the core ask)

Current loop is reactive (PM slices whatever issues exist, Engineer does the minimum to close them). These changes make auto-pi own the outcome.

### D1. PM owns roadmap & expands scope (not minimal)

- [ ] `personas/pm.md` + `extensions/loop/pm-context.js`: mandate **roadmap ownership loop**: every cycle PM (1) reads `manifest.md` roadmap checkboxes + `project-state.md` + `CHANGELOG.md`, (2) verifies open/issues/PRs cover *all* unchecked manifest scope (keep `dfe73da` invariant as a test, not just a fix), (3) creates missing sub-issues, (4) appends `## Scope proposals` when it spots valuable adjacent work (with rationale + effort XS/S + acceptance criteria), capped by `limits.maxBatchIssues`.
- [ ] Add `manifest.md` checkbox parser (`extensions/loop/manifest-scope.js` + tests): `unchecked manifest items − covered issues = gap set`. Dispatcher refuses WAIT while gap set is non-empty (except budget/stop).
- [ ] Done-definition enforcement: PM never marks manifest done while `project-state.md` skeleton markers (`TODO/skeleton/placeholder`) remain; Engineer template `manifest.md.j2` fallback must be flagged `needs-pm` immediately.
- [ ] Priority labels: keep `0ad836b` priority-label work; document the label vocabulary in the glossary (B3).

### D2. Quality gates that prevent "minimal PR" merges

- [ ] `personas/engineer.md` + `review-engineer.md`: require **expansion checklist** in every PR body: `Scope covered / Adjacent gaps found / Tests added / Docs updated / Demo verified`. Reviewer rejects PRs that close the issue but leave obvious adjacent gaps unfiled as follow-up issues.
- [ ] Generated-project CI (template `ci.yml.j2`): add coverage-threshold + `manifest-scope` check (fail if PR reduces core coverage or leaves `TODO/skeleton` markers). Harness dogfoods the same via Phase C CI.
- [ ] `policies/done-definition.md`: extend task→PR→project done chain with "no skeleton markers + demo deploy green + CHANGELOG entry".

### D3. Operator console becomes a control plane (UI leads too)

- [ ] Add write actions behind explicit confirm + token: `POST /api/loop/{stop,resume,restart,switch}` + `POST /api/issues` (PM backlog inject). UI gets Pause/Resume/Restart/Switch + "Propose scope" buttons. Every action appends to `events.jsonl`.
- [ ] Budget/cost panel: surface `limits.*` vs actual `usage.jsonl` with progress bars + stop-reason banner (`stopped-budget/stopped-manual/needs-human`).
- [ ] Timeline deep-links: every `issue/PR` event links to GitHub URL; dispatch decisions show rationale.

### D4. Observability & cost control

- [ ] Per-persona token/cost caps actually enforced (config has `maxPromptTokensPerPersona/maxOutputTokensPerPersona` = 0/unlimited + `d90c835/827a4d1` removed limits by default): add UI warnings at 70%/90% + loop WAIT with `needs-human` at 100% when caps are set.
- [ ] `personaInactivityMs/personaTimeoutMs` (`9504014` wall-clock timeout): surface hung-persona state in `/api/status` + UI banner + `errors.jsonl`.
- [ ] Telegram (M11): include scope-proposal + quality-gate events, not just done/needs-human.

---

## 6. Phase E — Structural refactors (P2, after C)

- [ ] Split `persona-runner.js` (973 lines), `orchestrator.js` (1133 lines), `logging/core.js` (960 lines) into `core/` (pure, tested) + `adapters/` (gh/pi/fs side effects) per `engineering-guidelines.md` layered arch.
- [ ] Convert hot `core.js` files to TypeScript (`strict`, `noUncheckedIndexedAccess`) incrementally, starting with `skills/github`, `skills/config`, `loop/dispatcher`, `loop/state-scanner`. Add `tsc --noEmit` to CI.
- [ ] Unify provider/model resolution: single `resolveProviderModel({ctx, config, env})` used by doctor/loop/persona-runner (replaces `provider-config.js` + `provider-env.js` + ad-hoc `ctx.model` overrides).
- [ ] Template renderer: replace dep-free Jinja subset in `seed/scaffold.js` (270 lines) with a pinned micro-templating dep or fully-tested local module + fuzz tests for `{{var}}/{%if%}/{%for%}` edge cases.
- [ ] Lock/stop/state files: extract `loop/state-files.js` (`acquire/release/checkLock/write/removeStop`) — currently scattered across orchestrator/harness/scripts; add stale-lock + crash-recovery tests (extends `dc5aa3c` deadlock fix).

---

## 7. Suggested execution order & effort

| Order | Phase | Effort | Why first |
|---|---|---|---|
| 1 | A fixes & cleanup | 2–3 d | Unblocks everything, zero risk |
| 2 | B docs | 2 d (parallel with A) | Kills contradictions confusing contributors/PM |
| 3 | C1 lint/format/CI | 1–2 d | Force-multiplier; every later diff is gated |
| 4 | C4 backend tests | 3–4 d | Locks behavior before refactors |
| 5 | C2+C3 UI productionization | 4–5 d | Visible operator value |
| 6 | D PM-leads-scope + gates | 1 wk | The headline feature |
| 7 | D3 control-plane + D4 observability | 1 wk | UI becomes indispensable |
| 8 | E structural/TS split | ongoing | Pay down as you touch files |

Total ≈ 4–6 weeks single-engineer, or ~2 weeks with PM/Engineer/Review personas each owning a phase (dogfood the harness on itself).

## 8. Definition of done for this plan

- [ ] `npm run lint && npm run format:check && npm test && npm run test:coverage && npm run ui:build` green locally and in CI (Node 18 + 20).
- [ ] Zero stale docs: `tests/README`, `todo/M0/M13`, `pilot-report §4`, `pi.extensions`, `plan.md` refs all resolved.
- [ ] Zero known dead code; `rg TODO|FIXME|HACK|placeholder|skeleton` hits only intentional template fallbacks covered by `needs-pm` flow.
- [ ] UI: localhost-by-default, authed remote, responsive, error-bounded, tested; backend serves SPA + clamped streaming API with contract tests.
- [ ] PM demonstrated on a pilot repo: seeds a skeleton, then **expands** it across ≥3 loop cycles without human prompts (manifest gaps → issues → PRs → reviews → Pages green), with scope proposals logged in timeline.
- [ ] `CHANGELOG.md` records each phase; `docs/architecture.md` + glossary + `CONTRIBUTING.md` reviewed and linked from `README.md`.

---

## Appendix — file-level punch list (for issue creation)

- `scripts/stub.js` → delete · `scripts/README.md` → drop stub row · `scripts/logs.js` + `extensions/harness.ts:48-88` → shared `readTailLog` · `scripts/resume.js` + `harness.ts:100-135` → shared `resumeLoop` · `scripts/notify.js:102` → document always-0 · `scripts/pages.js` → 3-code scheme · `scripts/restart.js` → align timeout code.
- `extensions/harness.ts` → split per-command modules when adding control-plane POSTs · `extensions/loop/orchestrator.js:733ff` → `warnOrLogError` · `persona-runner.js:445,458` → import defaults · `provider-config.js` + `provider-env.js` → unify · `gonkaapi.ts`/`joingonka.ts` → `providers.js` factory · `doctor/core.js:248` → provider-derived constant.
- `config/config.schema.json: `additionalProperties:true`` → tighten (or document why loose) · `config.default.json` → document 0=unlimited convention next to every limit.
- `templates/project/*.j2` → orphan-scaffold test · `vite.config.ts.j2:4`, `manifest.md.j2:39`, `project-state.md.j2:7` markers → `needs-pm` flow test.
- `ui/server/server.js:43` → `--port/--host` parsing · CORS/auth/static/ETag/clamp/logging/shutdown/factory extraction.
- `ui/src/*` → ErrorBoundary, `useDashboardPoll`, responsive grid, keys, `VITE_API_BASE`, skeletons, a11y, `eventStyle` map, `format.test.ts`.
- `tests/README.md`, `docs/*`, `todo/M0/M12/M13`, `package.json pi.extensions`, `.gitignore .pi/` rule — see Phase B.
