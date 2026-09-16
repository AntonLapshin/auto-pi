# UI Monitor

Operator console for the auto-pi loop: a single-page dashboard showing live
status and progress. It is a *monitor* of the engine, not a GitHub viewer —
detailed PR/issue content lives on GitHub. It answers:

- Is the loop running? Which persona is active right now?
- How many persona runs have happened, and what were the outcomes?
- LLM-provider health: success rate, retries, recent failures.
- Persona health: per-persona run counts, ok/error rates, tokens.
- A timeline of deterministic progress events (persona spawn/finish, git/gh
  commands, issue/PR lifecycle, dispatch decisions, LLM retries).
- Token usage over the last 14 days.

## Architecture

```
┌─────────────────────┐   fetch /api/*    ┌──────────────────────────┐
│  Vite + React + TS  │ ───────────────►  │  Node backend (no deps)  │
│  + Tailwind (ui/src)│                   │  ui/server/server.js     │
└─────────────────────┘                   └────────────┬─────────────┘
                                                       │ reads
                                        ┌──────────────▼──────────────┐
                                        │  {workspace}/.pi/logs/      │
                                        │  runs.jsonl events.jsonl    │
                                        │  health.jsonl errors.jsonl  │
                                        │  usage.jsonl summary.jsonl  │
                                        └─────────────────────────────┘
```

The backend resolves the active project from `~/.auto-pi/current-project.json`
(the same record the loop writes at seed time) and serves its local
`.pi/logs/` ledgers as JSON. It is dependency-free (plain Node `http`) and
intended for local use. See
[architecture.md](architecture.md#one-active-project-per-machine) for the
workspace layout.

## Running

First install the UI dependencies (one time — without this `vite` is missing
and `npm run ui:dev` fails with `vite: command not found`):

```bash
npm run ui:install
#    or: npm --prefix ui ci --no-audit --no-fund
```

Then start two processes:

```bash
# 1. Backend API on http://localhost:8787
npm run ui:server
#    or: node ui/server/server.js
#    or: node ui/server/server.js --port 8787 --host 127.0.0.1
#    (env overrides: AUTOPI_UI_PORT / AUTOPI_UI_HOST; flags win over env)

# 2. Vite dev server on http://localhost:5173 (proxies /api → 8787)
npm run ui:dev
#    or: cd ui && npm run dev
```

Then open **http://localhost:5173**.

For a production-style single server, build the UI and serve the static
`dist/` alongside the API:

```bash
npm run ui:build      # → ui/dist
node ui/server/server.js   # serves /api/* (static serving optional)
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/status`    | Project identity, loop state, active persona, stats, usage, health |
| `GET /api/events`    | Structured progress-event timeline (`?limit=N`) |
| `GET /api/runs`      | Persona run records (`?limit=N`) |
| `GET /api/health`    | LLM-provider health summary + recent records |
| `GET /api/usage`     | Token usage per day / per cycle |
| `GET /api/errors`    | Recent errors (`?limit=N`) |
| `GET /api/summary`   | Latest machine-readable execution summary |
| `GET /api/esp-status` | Tiny ESP32 pocket-monitor payload v9 (proj/loop, stuck, persona, model, lastAction/lastActionAgoS last meaningful action, last10LlmStatus LLM bar history, lastLlmCallFinished liveness) |
| `GET /api/healthz`   | Liveness |

All endpoints are read-only and intended for local use.

## ESP32 / LAN polling

The ESP32 pocket monitor polls `GET /api/esp-status` over the LAN. Two things
must both be true, or the request refuses/times out:

1. **The backend must be running.** It does not survive a reboot and
   `/loop-resume` does not start it — it only resumes the autonomous loop.
   After a restart, start it again (`npm run ui:server`) or run it as a
   user service so it autostarts on login:

   ```bash
   mkdir -p ~/.config/systemd/user
   cp systemd/auto-pi-ui.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now auto-pi-ui.service
   ```

2. **Use the right host *and* port.** The backend listens on port **8787**
   (default host `127.0.0.1`). From another machine on the same Wi-Fi the
   backend must bind to all interfaces (`--host 0.0.0.0` or
   `AUTOPI_UI_HOST=0.0.0.0`), and the URL must include `:8787`:

   ```bash
   # on the dev machine:
   node ui/server/server.js --host 0.0.0.0
   curl http://127.0.0.1:8787/api/esp-status

   # from another host on the LAN (example dev-machine IP 192.168.7.131):
   curl http://192.168.7.131:8787/api/esp-status
   ```

    `curl http://192.168.7.131/api/esp-status` (no port, i.e. implicit port 80)
    will always fail — nothing listens on port 80. Locally that surfaces as
    `Connection refused`; from another host it typically just hangs until it
    times out (SYN dropped by firewall/no listener).

### ESP32 v9 payload (trimmed)

v9 keeps only what the pocket display shows — old firmware must upgrade.
See `/api/status` for the full dashboard payload (provider, stats, usage).

```
{proj} ({loop} → ON/OFF)   e.g. timeline (ON)
{model}                     e.g. deepseek-ai/DeepSeek-V4-Flash-0731
{last10LlmStatus}           e.g. 10 bars, green=true / red=false (newest last)
{lastLlmCallFinished → "5m ago"}   e.g. last llm call 5m ago
{lastAction + lastActionAgoS → "3m ago"}  e.g. commit 3m ago
{persona}                   e.g. ENGINEER
{stuck} → STUCK             large red text when true
```

* `lastAction` / `lastActionAgoS` — last GitHub-visible action (issue/PR
  create, review, merge, push/commit), not the loop heartbeat. `-` / `-1`
  when none yet.
* `last10LlmStatus` — up to 10 booleans, newest first, from `health.jsonl`
  (success or fail). Empty when no LLM calls recorded yet.
* `lastLlmCallFinished` — seconds since the newest `health.jsonl` record
  (success or fail); `-1` when none yet.
* `stuck=true` when the active persona record is older than
  `loop.personaTimeoutMs` (default 1h) or silent longer than
  `loop.personaInactivityMs` (default 10m), or active while the loop is dead.

## Data source

The dashboard reads the deterministic, structured ledgers written by the loop
into the active project's `.pi/logs/`:

- `events.jsonl` — progress events (persona spawn/finish, git/gh commands,
  issue/PR lifecycle, dispatch, LLM retries)
- `health.jsonl` — LLM-provider health records
- `runs.jsonl` — persona run records
- `errors.jsonl` — errors
- `usage.jsonl` — per-day/per-cycle token accumulation
- `summary.jsonl` — latest machine-readable execution summary

See `skills/logging/SKILL.md` for the full log schemas.
