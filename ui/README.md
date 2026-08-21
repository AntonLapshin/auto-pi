# auto-pi monitor (UI)

A lightweight single-page dashboard that shows the **live status and progress**
of the auto-pi autonomous engineering loop. It is a *monitor* of the engine, not
a GitHub viewer — detailed PR/issue content lives on GitHub. This UI answers:

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
`.pi/logs/` ledgers as JSON. It is dependency-free (plain Node `http`).

## Running

Two processes (or use the two terminals below):

```bash
# 1. Backend API on http://localhost:8787
npm run ui:server
#    or: node ui/server/server.js

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
| `GET /api/healthz`   | Liveness |

All endpoints are read-only and intended for local use.

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
