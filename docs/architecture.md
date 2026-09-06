# Architecture

How the auto-pi harness fits together: which part owns what, how the loop
turns GitHub state into persona sessions, where state lives, and the shared
vocabulary (labels, markers, decisions) every part speaks.

## Harness map

```
┌──────────────┐  pi.registerCommand()  ┌─────────────────────────┐
│ extensions/  │ ─────────────────────► │ Pi slash commands       │
│  seed/ pull/ │                        │ /loop-seed … /loop-     │
│  loop/       │                        │ doctor (+ /loop)        │
│  doctor/     │                        └────────────┬────────────┘
│  harness.ts  │                                     │ delegate to core
│  providers   │                                     ▼
└──────────────┘                        ┌─────────────────────────┐
┌──────────────┐  node scripts/<cmd>.js │ extensions/loop/*.js    │
│ scripts/     │ ─────────────────────► │ skills/*/core.js        │
│ (thin CLIs)  │  same core, no Pi      │ (pure, tested core)     │
└──────────────┘                        └────────────┬────────────┘
                                                     │ persona sessions,
                                                     │ gh API, filesystem
                                                     ▼
                                        ┌─────────────────────────┐
                                        │ Loop runtime per cycle: │
                                        │ scanner → dispatcher →  │
                                        │ context packer → runner │
                                        └────────────┬────────────┘
                                                     │ writes
                                                     ▼
                                        ┌─────────────────────────┐
                                        │ Ledgers (.pi/logs/*.    │
                                        │ jsonl) → UI monitor     │
                                        └─────────────────────────┘
```

- **`extensions/`** — Pi integration (thin adapters). `seed/`, `pull/`,
  `loop/`, `doctor/` subdirectories plus `harness.ts` (status/logs/resume/
  sync-config/provider commands) register slash commands via
  `pi.registerCommand()` and delegate to core. `gonkaapi.ts` / `joingonka.ts`
  register the bundled LLM providers.
- **`scripts/`** — fallback Node CLIs (`node scripts/<cmd>.js`, exposed as
  `npm run <cmd>`). Thin: parse argv, call the same core the extensions use,
  exit with a code. See the [`scripts/`](../scripts/README.md) table and the
  [`scripts/<cmd>.js` ↔ `/loop-<cmd>` mapping](#command-mapping) below.
- **`skills/`** — reusable capabilities with tested core (`core.js`) + Pi
  skill wrapper (`SKILL.md`): `github` (resilient `gh` client with
  retry/backoff + rate-limit handling), `budget-guard`, `config`
  (validation/sync), `logging` (ledgers, redaction, rotation), `status`
  (status aggregation), `telegram-notify`.
- **`extensions/loop/`** — the autonomous engine:
  - `state-scanner.js` reads GitHub state (issues/PRs/labels/CI) into a
    summary;
  - `dispatcher.js` maps that summary to one decision (`stop` / `wait` /
    `pm` / `engineer` / `engineer_merge` / `review`; see
    `constants.js` `DECISION`);
  - `pm-context.js` / `engineer-context.js` / `review-context.js` build the
    focused context file for the chosen persona;
  - `persona-runner.js` spawns the persona in a **fresh** Pi session,
    records the run, enforces retry/timeout/budget guards;
  - `orchestrator.js` owns the loop process (lock, stop file, cycle sleep,
    `reliability.js` checks, budget checks).
- **`personas/`** — the three persona prompts (`pm.md`, `engineer.md`,
  `review-engineer.md`). Personas never remember prior conversations; all
  context comes from the packed context file + the repo. See
  [personas.md](personas.md).
- **`policies/`** — cross-cutting rules excerpted into persona contexts
  (engineering guidelines, testing, PR/issue granularity, security,
  done-definition).
- **`templates/`** — the generated-project scaffold (`.j2` templates for a
  React/Tailwind/TS + Vitest project with CI and Pages deployment).
- **`config/`** — `config.default.json` (single source of truth for defaults)
  + `config.schema.json` (validation at seed and loop start). See
  [configuration.md](configuration.md).
- **`ui/`** — the operator monitor (Vite + React frontend, dependency-free
  Node API backend reading the ledgers). See [ui.md](ui.md).

Thin adapters, tested core: `scripts/`, extension index files, and UI
components stay thin; logic lives in importable, unit-tested core modules
(`skills/*/core.js`, `extensions/loop/*.js`).

## One active project per machine

The harness enforces **exactly one active project per machine** so loop state,
lock file, and budget accounting stay unambiguous. The active project is
recorded in `~/.auto-pi/current-project.json`; each project's workspace lives
under `~/.auto-pi/workspaces/{owner}/{repo}/repo` with harness state in
`.pi/`:

- `.pi/config.json` — project config (committed; no secrets)
- `.pi/state/loop.lock` — PID lock (one loop per project)
- `.pi/state/stop` — stop marker (pause; record preserved)
- `.pi/state/initiation.json` — seed marker (makes `/loop-switch` and the
  loop recognize the workspace)
- `.pi/logs/*.jsonl` — structured ledgers (runs/errors/summary/usage/
  events/health) + `latest.log`, `summary.md`, `loop.out`
- `.pi/runs/{runId}/` — per-run context/stdout/stderr
- `.pi/local.json` — secrets (git-ignored, never committed)

`/loop-stop` pauses (writes the stop file, keeps the record);
`/loop-resume` clears it; `/loop-switch` moves the record to another local
project; `/loop-seed` stops the current loop first (**stop-then-seed**),
then seeds the new project as active. See
[commands.md](commands.md#loop-seed).

## Fresh-session persona model

Every persona runs in a **new** Pi session: no conversation memory, no
session persistence. The loop passes everything the persona needs as files
(context pack + repo checkout); output is captured to the run dir and the
ledgers. A hung or crashed persona therefore can't corrupt loop state — the
orchestrator just records the failure (retry/backoff, wall-clock timeout,
consecutive-failure stop) and moves to the next cycle.

## Label glossary

Single source of truth for the labels the harness, personas, and dispatcher
share (authoritative constants in `extensions/loop/constants.js` `LABELS` /
`SIZES` / `TYPES`). Casing is lowercase (`size:xs`, never `size:XS`).

### `pi:*` workflow labels (state machine)

| Label | Meaning | Set by | Cleared by |
|-------|---------|--------|------------|
| `pi:ready` | Issue is planned and ready for the Engineer | PM | Engineer (picks it up) |
| `pi:review-needed` | PR needs Review Engineer verification | Engineer (opens PR) | Review Engineer (decision) |
| `pi:review-requested` | Review explicitly requested (alias the dispatcher also treats as needs-review) | Engineer | Review Engineer |
| `pi:approved` | PR verified (label-vote; GitHub blocks formal self-approval by the same account) | Review Engineer | — (terminal for the PR) |
| `pi:merge-ready` | Approved PR is ready to squash-merge | Review Engineer | Engineer (merges) |
| `pi:changes-requested` | PR needs Engineer rework (`PI-REVIEW` comments explain) | Review Engineer | Engineer (pushes fixes; back to `pi:review-needed`) |
| `pi:merge-blocked` | Approved PR cannot merge (e.g. branch protection / failing checks) | Loop | Loop/Engineer once unblocked |
| `pi:conflict` | PR has a merge conflict; Engineer must resolve | Loop (conflict detection) | Engineer (resolves) |
| `pi:needs-pm` | Issue needs PM attention (scope-too-large, needs split/clarify) | Engineer | PM (splits → `pi:ready` sub-issues) |
| `pi:pm-note` | Carries a `PI-NOTE persona=PM …` directive for the PM | Engineer/PM | PM (handles the note) |
| `pi:blocked` | Work cannot proceed yet (attempt cap hit, external blocker) | Loop/PM | Human or PM once resolved |
| `pi:needs-human` | A human decision is required; the dispatcher WAITs | Loop/PM | Human (acts, removes label, resumes) |

Typical flows: `pi:ready` → Engineer → `pi:review-needed` →
`pi:approved` + `pi:merge-ready` → merged; or → `pi:changes-requested` →
Engineer fixes → `pi:review-needed` again. Blocked work accumulates
`pi:blocked` (+ `pi:needs-human` when the loop can't proceed alone).

### `type:*` / `size:*` / `milestone:*` / `priority:*` labels

| Label | Meaning |
|-------|---------|
| `type:feature` / `type:bug` / `type:refactor` / `type:test` / `type:infra` | What kind of work the issue is (`type:infra` also marks Pages/infra blocks) |
| `size:xs` / `size:s` | Fits one Engineer session (the only sizes the PM creates; larger work is split into a milestone first) |
| `size:m` / `size:l` | Larger than one session — must be split before an Engineer picks it up |
| `milestone:{slug}` | Groups issues into a milestone slice |
| `priority:p1` / `priority:p2` / `priority:p3` | Advisory build order (`p1` first); every issue carries one |

### Issue-body markers

| Marker | Meaning |
|--------|---------|
| `PI-NOTE persona=PM reason=<reason> action=<action>` | Directive left on an issue for the PM (`scope-too-large → split`, `needs-clarification → clarify`, `blocked → unblock`) |
| `PI-REVIEW type=… severity=blocking|… location=…` | Review Engineer finding on a PR, with verification command + expected outcome |
| `PI-HUMAN` | Marks the `pi:needs-human` handoff issue content (created/updated by the Pages/deploy health check) |

## Command mapping

Every slash command maps to a fallback CLI (note the bare `/loop`
exception — its CLI is `scripts/loop.js` / `npm run loop`):

| Slash command | Fallback CLI | Core |
|---------------|--------------|------|
| `/loop` | `npm run loop` / `node scripts/loop.js` | `extensions/loop/orchestrator.js` |
| `/loop-seed` | `npm run seed` / `node scripts/seed.js` | `extensions/seed/core.js` |
| `/loop-pull` | `npm run pull` / `node scripts/pull.js` | `extensions/pull/core.js` |
| `/loop-stop` | `npm run stop` / `node scripts/stop.js` | `extensions/loop/orchestrator.js` |
| `/loop-restart` | `npm run restart` / `node scripts/restart.js` | `extensions/loop/orchestrator.js` |
| `/loop-switch` | `npm run switch` / `node scripts/switch.js` | `extensions/loop/orchestrator.js` |
| `/loop-status` | `npm run status` / `node scripts/status.js` | `skills/status/core.js` |
| `/loop-logs` | `npm run logs` / `node scripts/logs.js` | `extensions/loop/log-helpers.js` |
| `/loop-resume` | `npm run resume` / `node scripts/resume.js` | `extensions/loop/orchestrator.js` |
| `/loop-sync-config` | `npm run sync-config` / `node scripts/sync-config.js` | `skills/config/*` |
| `/loop-provider` | — (interactive only) | `extensions/loop/provider-config.js` |
| `/loop-doctor` | `npm run doctor` / `node scripts/doctor.js` | `extensions/doctor/core.js` |
| — | `npm run pages` / `node scripts/pages.js` | `extensions/seed/deploy.js` |
| — | `npm run notify` / `node scripts/notify.js` | `skills/telegram-notify/*` |
