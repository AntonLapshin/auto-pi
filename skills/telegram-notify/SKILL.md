# Telegram Notifications

Optional, env-driven notifications for key auto-pi lifecycle events (Milestone 11,
plan.md §24, §28). When enabled, the harness sends a Telegram message when:

- the **project is completed** (done) — with project name, repo, and demo URL,
- the project **needs human attention** (reason + repo URL),
- the loop **stopped due to budget**,
- the loop **stopped manually** (if `notifyOnStopped`).

When disabled, or when the required env vars are absent, this skill is a silent
no-op — it never fails or breaks the loop.

## Configuration (plan.md §24)

All under `config.notifications.telegram` in `{workspace}/.pi/config.json`:

| Key               | Default               | Meaning                                   |
|-------------------|-----------------------|-------------------------------------------|
| `enabled`         | `false`               | Master switch for Telegram notifications  |
| `botTokenEnv`     | `TELEGRAM_BOT_TOKEN`  | Env var holding the bot token             |
| `chatIdEnv`       | `TELEGRAM_CHAT_ID`    | Env var holding the chat id               |
| `notifyOnDone`    | `true`                | Send "project completed"                  |
| `notifyOnStopped` | `true`                | Send "loop stopped" (budget or manual)    |
| `notifyOnNeedsHuman` | `true`             | Send "needs human attention"              |

Enable it in the project config and set the two env vars (or `local.json`):

```json
{
  "notifications": { "telegram": { "enabled": true } }
}
```

```bash
export TELEGRAM_BOT_TOKEN=123456789:AA...
export TELEGRAM_CHAT_ID=123456789
```

See `extensions/seed/config.js` (`.pi/local.example.json`) for the env-var pattern.

## How the harness sends notifications

The PM persona writes a git-ignored completion marker at `.pi/state/completed.json`
when the project is done:

```json
{ "status": "done", "completedAt": "<ISO>", "repo": "owner/repo", "demoUrl": "<url or null>" }
```

The loop orchestrator observes this file (and the budget / needs-human / stop
decisions) and calls the shared core in `skills/telegram-notify/core.js`, which
posts the message to the Telegram Bot API and returns without throwing on any
failure.

## Secrets

The bot token and chat id are read from environment variables at runtime and are
**never written to logs, summaries, config, or message bodies**. `redactTelegram()`
scrubs token/chat-id-shaped values from any text before it reaches harness logs
(plan.md §24, §7.2). Do not bypass redaction — e.g. never log the raw `fetch`
response body (it can echo the chat id).

## Usage

The core is plain JS at `skills/telegram-notify/core.js`, shared by the loop
orchestrator, the `scripts/notify.js` CLI, and tests.

```js
import { notifyEvent, redactTelegram, telegramOptions } from "../core.js";

await notifyEvent({
  workspace, config,
  event: "done",            // "done" | "needs-human" | "stopped-budget" | "stopped-manual"
  reason: "...",
  completed,                // parsed completed.json (for "done")
});
```

Fallback CLI:

```bash
node scripts/notify.js --event done --reason "All milestones complete"
```
