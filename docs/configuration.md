# Configuration

Reference for the auto-pi project config (`config/config.default.json` and the
generated `{project}/.pi/config.json`).

The harness ships a default config (`config/config.default.json`) and a
JSON-Schema (`config/config.schema.json`). At `/loop-seed` time the default is copied
to `{project}/.pi/config.json` with the `project` section filled in. The config
is **validated** against the schema at `/loop-seed` and at loop start (M13) — an
invalid config fails fast with a clear message.

Use `/loop-sync-config` (or `npm run sync-config`) to recopy the harness defaults
into an existing project while preserving project-specific values.

## Sections

### `project`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `name` | string | `""` | human-friendly project name |
| `repo` | string | `""` | repo slug |
| `owner` | string | `""` | GitHub owner |
| `ownerEmail` | string | `""` | owner email |
| `defaultBranch` | string | `"main"` | default branch |
| `demoUrl` | string | `""` | GitHub Pages demo URL |

### `pi`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `model` | string | `""` | Pi model id |
| `provider` | string | `""` | Pi provider |
| `contextMaxTokens` | int | `150000` | model context window (budget guard) |

### `loop`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `intervalSeconds` | int | `60` | sleep between cycles |
| `stopOnBudgetExceeded` | bool | `true` | stop the loop when budget exceeded |
| `maxConsecutiveFailures` | int | `3` | stop with repeated-failure reason after N consecutive failures |

### `limits`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `maxBatchIssues` | int | `3` | max issues the PM creates per batch |
| `maxIssueAttempts` | int | `3` | cap repeated attempts per issue; beyond → `pi:blocked` + `pi:needs-human` |
| `maxTokensPerCycle` | int | `250000` | max tokens per loop cycle |
| `maxTokensPerDay` | int | `750000` | max tokens per day |
| `maxCostPerDayUsd` | number | `20` | max estimated cost per day (USD) |
| `maxPromptTokensPerPersona` | int | `135000` | max prompt tokens per persona |
| `maxOutputTokensPerPersona` | int | `8000` | max output tokens per persona |

### `github`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `autoCreateRepo` | bool | `true` | auto-create the repo at seed |
| `repoVisibility` | enum | `"private"` | `"public"` or `"private"` |

### `stack`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `framework` | enum | `"react"` | scaffold framework |
| `typescript` | bool | `true` | use TypeScript |
| `tailwind` | bool | `true` | use Tailwind |
| `testRunner` | enum | `"vitest"` | test runner |

### `quality`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `coreCoveragePercent` | int | `100` | required core coverage |
| `featureBranches` | bool | `true` | use feature branches |

### `review`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `reviewerCanPushTestCommits` | bool | `false` | whether the Review Engineer may push test commits to PR branches |

### `pages`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enabled` | bool | `true` | enable GitHub Pages |
| `deployBranch` | string | `"gh-pages"` | Pages deploy branch |

### `notifications.telegram`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enabled` | bool | `false` | master switch |
| `botTokenEnv` | string | `"TELEGRAM_BOT_TOKEN"` | env var holding the bot token |
| `chatIdEnv` | string | `"TELEGRAM_CHAT_ID"` | env var holding the chat id |
| `notifyOnDone` | bool | `true` | notify on project done |
| `notifyOnStopped` | bool | `true` | notify on loop stopped |
| `notifyOnNeedsHuman` | bool | `true` | notify when human attention is needed |

### `logging`

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `maxFileSizeMb` | int | `10` | max log file size before rotation |
| `rotate` | bool | `true` | rotate logs when they exceed the max size |

## Secrets

`.pi/config.json` carries **no secrets** — only env-var *names*. Local secrets
live in the git-ignored `.pi/local.json` and are read from environment variables
at runtime. See [security-policy](../policies/security-policy.md).
