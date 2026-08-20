---
name: github
description: >
  Resilient `gh` CLI client with retry/backoff for transient failures and
  rate-limit handling (reads `X-RateLimit-Reset`). The loop's default GitHub
  access so transient network blips do not crash the loop (plan.md §28, M13).
---

# github

Shared GitHub client with hardening (plan.md §28 "Milestone 13").

## Retry / backoff

`createGhClient()` returns an async `gh(args, opts)` function with the same
shape as the existing helpers (`{ ok, stdout, stderr, exitCode }`). It retries
transient failures — network timeouts, 5xx server errors, `gh` process failures
— with exponential backoff + full jitter. Configurable via `maxRetries`
(default 3), `baseDelayMs` (default 1000), `maxDelayMs` (default 30000).

## Rate-limit handling

When GitHub returns HTTP 403/429 (rate limit exceeded), the client reads
`X-RateLimit-Reset` (passed via `opts.rateLimitReset`) and backs off until that
timestamp (plus a 1s safety margin), then retries. When the reset time is
unknown, it uses a 15s cooldown.

## Usage

The loop orchestrator uses the resilient client by default:

```js
import { createGhClient } from "./skills/github/core.js";
const gh = createGhClient({
  onRetry: (info) => console.log(`retry ${info.attempt}: ${info.reason}`),
});
const res = await gh(["issue", "list", "--repo", "o/r", "--state", "open"]);
```

The client is fully testable with a fake `runner` (see `tests/hardening.test.js`).
Core logic lives in `skills/github/core.js` (plain JS).
