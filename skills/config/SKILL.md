---
name: config
description: >
  Validate the auto-pi project config (`config/config.schema.json`) and sync it
  back to harness defaults while preserving project-specific values
  (`/loop-sync-config`, plan.md §3.3). Fails fast at `/loop-seed` and loop start when the
  config is invalid.
---

# config

Config validation and sync for the auto-pi harness (plan.md §3.3, M13).

## Validation

`validateConfig(config)` validates a parsed config object against the harness
JSON-Schema (`config/config.schema.json`). It checks:

- top-level sections are objects (`project`, `pi`, `loop`, `limits`, `github`,
  `stack`, `quality`, `review`, `pages`, `notifications`, `logging`)
- `project.*` string fields
- `pi.contextMaxTokens` (>= 1000)
- `loop.intervalSeconds` (>= 5), `loop.maxConsecutiveFailures` (>= 1),
  `loop.stopOnBudgetExceeded` (boolean)
- `limits.*` numeric fields (>= 1, except `maxCostPerDayUsd` >= 0)
- `github.repoVisibility` enum (`public`/`private`), `github.autoCreateRepo` boolean
- `stack.framework` = `react`, `stack.testRunner` = `vitest`
- `quality.coreCoveragePercent` (0–100)
- `pages.enabled` boolean
- `logging.maxFileSizeMb` (>= 1), `logging.rotate` boolean

The loop orchestrator calls `validateConfig` at the start of every cycle and
`extensions/seed/core.js` validates the generated config at `/loop-seed`. An invalid
config fails fast with a clear list of problems instead of silently misbehaving.

## Sync (`/loop-sync-config`)

`syncConfig(workspace)` recopies `config/config.default.json` into
`{workspace}/.pi/config.json` while preserving:

- the whole `project` section (name, repo, owner, ownerEmail, demoUrl,
  defaultBranch)
- any `custom` object (user overrides / local knobs)
- any `notifications.telegram` overrides

Every other section is recopied from the defaults, so new default knobs added
in later milestones propagate to existing projects without clobbering the
project identity. Use `/loop-sync-config` (or `npm run sync-config`) after upgrading
the harness to pick up new defaults.

Core logic lives in `skills/config/core.js` (plain JS, shared with the loop
and the `scripts/sync-config.js` fallback CLI).
