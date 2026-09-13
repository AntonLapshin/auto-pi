# auto-pi monitor (UI)

A lightweight single-page dashboard that shows the **live status and progress**
of the auto-pi autonomous engineering loop. It is a *monitor* of the engine, not
a GitHub viewer — detailed PR/issue content lives on GitHub.

Full operator guide (architecture, running, API table, ledger schemas):
[`docs/ui.md`](../docs/ui.md).

## Running

First install the UI dependencies (one time — without this `vite` is missing
and `npm run ui:dev` fails with `vite: command not found`):

```bash
npm run ui:install
#    or, from the repo root: npm --prefix ui ci --no-audit --no-fund
```

Then start two processes (or use the two terminals below):

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
