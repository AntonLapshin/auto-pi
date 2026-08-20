# Telegram Notifications

Optional, env-driven Telegram lifecycle notifications (M11, plan §24).

## Setup

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather) and get its
   token.
2. Get your chat ID (e.g. via `@userinfobot` or the bot API).
3. Export the env vars (or set them in the git-ignored `.pi/local.json`):

   ```bash
   export TELEGRAM_BOT_TOKEN=123456789:AA...
   export TELEGRAM_CHAT_ID=123456789
   ```

4. Enable notifications in `config.notifications.telegram` (or via
   `/loop-sync-config` after editing `.pi/config.json`):

   ```json
   "notifications": {
     "telegram": { "enabled": true }
   }
   ```

## Events

| Event | When |
|-------|------|
| `done` | project completed (all milestones done, demo deployed) |
| `needs-human` | a human decision is required to continue |
| `stopped-budget` | loop stopped because the budget was exceeded |
| `stopped-manual` | loop stopped manually (stop file) |

## Config

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enabled` | bool | `false` | master switch |
| `botTokenEnv` | string | `"TELEGRAM_BOT_TOKEN"` | env var holding the bot token |
| `chatIdEnv` | string | `"TELEGRAM_CHAT_ID"` | env var holding the chat id |
| `notifyOnDone` | bool | `true` | notify on project done |
| `notifyOnStopped` | bool | `true` | notify on loop stopped |
| `notifyOnNeedsHuman` | bool | `true` | notify when human attention is needed |

## Behavior

- Notifications are **non-fatal**: when disabled or the env vars are absent, the
  harness silently skips them and the loop continues.
- Secrets rule: the bot token and chat id are read from env vars at runtime and
  are **never** written to logs, summaries, or message bodies.
- Send a notification manually from a shell:

  ```bash
  npm run notify -- --event done
  npm run notify -- --event needs-human --reason "Pages blocked"
  npm run notify -- --event stopped-budget
  ```
