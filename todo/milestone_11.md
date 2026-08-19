# Milestone 11: Telegram Integration

**Depends on:** Milestone 7, Milestone 10
**Reference:** plan.md §24, §28 "Milestone 11"

## Goal

Add an optional Telegram notification skill for key lifecycle events.

## Tasks

- [ ] Implement `skills/telegram-notify/` skill and `scripts/notify.js` fallback.
- [ ] Config-driven and env-driven (plan.md §24):
  - `notifications.telegram.enabled` (default false)
  - `notifications.telegram.botTokenEnv` = `TELEGRAM_BOT_TOKEN`
  - `notifications.telegram.chatIdEnv` = `TELEGRAM_CHAT_ID`
  - flags: `notifyOnDone`, `notifyOnStopped`, `notifyOnNeedsHuman`
- [ ] Send messages for events:
  - project completed (plan.md §24 completion message: project, repo, demo URLs)
  - project needs human attention (reason, repo URL)
  - loop stopped due to budget
  - loop stopped manually if configured
- [ ] If disabled or env vars absent, no-op without failure (no crash in loop).
- [ ] Never log the token or chat ID in harness logs (redact).

## Acceptance Criteria

With Telegram enabled and env vars present, messages are sent on done/needs-human/budget events.

With Telegram disabled or env vars missing, the loop continues without failure.
