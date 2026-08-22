# auto-pi

**Autonomous engineering team harness for Pi.**

`auto-pi` turns a Pi agent into an autonomous engineering team that seeds a project,
creates a GitHub repo, and runs a loop of fresh persona sessions (PM, Engineer,
Review Engineer) that build, test, review, and ship the project — all the way to a
deployed GitHub Pages demo — with minimal human supervision.

> This repository is the harness itself. `pi install /path/to/auto-pi` activates it
> inside your Pi agent environment.

## Quick demo

Spin up a brand-new project in one command:

```bash
/loop-seed Build a markdown notes app with tags and search
```

`/loop-seed` walks you through engaging with the project: it asks for an explicit
project name (the only fixed question), then an **agent evaluates your idea and asks
the follow-up questions that resolve its ambiguity** (or you can pick "use
assumptions" / pass `--yes` to proceed automatically), derives and creates a
GitHub repo, scaffolds a React/Tailwind/TypeScript project with CI and GitHub
Pages deployment, copies the project config, and starts the autonomous loop. From
there the PM plans issues, the Engineer implements and tests them, and the Review
Engineer verifies and approves — all without further input.

Non-interactively, the same flow runs from a shell:

```bash
npm run seed -- "Build a markdown notes app"          # prompts over stdin
npm run seed -- "Build a markdown notes app" --yes    # proceed on assumptions
```

## Prerequisites

- **Linux** (the harness and its shell tooling target a Linux environment; macOS is
  not currently supported).
- **Node.js** (≥ 18) and **npm**.
- **git**.
- **GitHub CLI `gh`** — used for authentication, repo creation, and API calls.
- **Pi** (`@earendil-works/pi-coding-agent`) — the coding agent the harness builds on.
- **Pi model configuration** — at least one provider/model configured for Pi, e.g.
  the bundled `joingonka` / `gonkaapi` providers (see
  [`extensions/joingonka.ts`](extensions/joingonka.ts),
  [`extensions/gonkaapi.ts`](extensions/gonkaapi.ts)). Set the matching API key:
  `export JOINGONKA_API_KEY=...` or `export GONKAAPI_API_KEY=...`.
- **GitHub account** — with a token that can create repos, issues, PRs, and
  workflow runs. See [GitHub Token setup](#github-token-setup).

Run `/loop-doctor` (or `npm run doctor`) to validate all prerequisites — it reports
exactly what is missing and how to fix it.

## One active project per machine

The harness enforces **exactly one active project per machine** at a time. This keeps
the loop's state, lock file, and budget accounting unambiguous. The active project is
recorded in `~/.auto-pi/current-project.json`.

- `/loop-stop` (or `npm run stop`) **pauses** the active project's loop: it writes the
  stop file (so the loop exits at its next cycle) but **preserves the active-project
  record**, so the project can be resumed or restarted anytime.
- `/loop-switch` (or `npm run switch`) stops the current project's loop, points the
  active-project record at a target locally-seeded project, and starts its loop. The
  previous project's workspace/state are preserved, so you can switch back anytime.
- `/loop-seed` (or `npm run seed`) creates a **brand-new** project: since `/loop-stop`
  preserves the active-project record, seeding safely stops the currently-active
  project's loop first, then seeds the new project as active.
- `/loop-restart` (or `npm run restart`) **restarts** the loop for the same project
  rather than pausing it: it safely stops the running loop (any in-flight persona
  finishes normally, never killed), waits for it to exit, and starts a fresh loop.
  Use `--timeout N` to control how long it waits for the old loop to exit (default 60s).

## Installation

Install the harness into your Pi environment by pointing `pi install` at this repo
(local path, git URL, or npm spec are all supported by Pi packages):

```bash
pi install /path/to/auto-pi
```

Pi registers the package's extensions from the `pi` block in `package.json`. After
installation the following slash commands are available:

| Command       | Purpose                                      |
|---------------|----------------------------------------------|
| `/loop-seed`   | Spin up a new project (clarify, create repo, scaffold, start loop) |
| `/loop-stop`   | Pause the autonomous loop (project stays active) |
| `/loop-restart`| Safely restart the autonomous loop (stop, then start again) |
| `/loop-switch` | Switch the active project to another locally-seeded project |
| `/loop-status` | Active project, loop, and persona status     |
| `/loop-logs`   | Show the latest local logs                   |
| `/loop-resume` | Resume a stopped/paused project's loop       |
| `/loop-sync-config`| Recopy config defaults, preserving project values |
| `/loop-provider` | Show or switch the loop's LLM provider/model (restarts the loop) |
| `/loop-doctor` | Validate environment prerequisites           |

Each command also has a fallback `npm run <cmd>` / `node scripts/<cmd>.js` entry for
non-interactive use (see [`scripts/`](scripts)).

> **Note on commands in `package.json`:** Pi registers slash commands
> programmatically via `pi.registerCommand()` in an extension
> (`extensions/harness.ts` for `/loop-status`, `/loop-logs`, `/loop-resume`,
> `/loop-sync-config`; `extensions/seed` for `/loop-seed`; `extensions/loop` for
> `/loop`/`/loop-stop`/`/loop-restart`/`/loop-switch`; `extensions/doctor` for
> `/loop-doctor`) — the `pi` block in `package.json` only declares resource
> directories.

To verify the installation loaded cleanly, start Pi and confirm `/loop-seed`,
`/loop-stop`, `/loop-status`, `/loop-doctor` show up in `/`-command completion.

## GitHub Token setup

The harness automates GitHub via the GitHub CLI. Authenticate once:

```bash
gh auth login        # follow the interactive prompts
gh auth status       # verify
```

Your token must have **`repo`** and **`workflow`** scopes (classic PAT) or, for a
fine-grained PAT, read/write on *Contents, Issues, Pull requests, Workflows, Pages*.
See [`docs/github-token.md`](docs/github-token.md) for the full scope table and setup
steps. Secrets are never written to versioned files; they live only in the
git-ignored `.pi/local.json` of the generated project or in environment variables.

## Repository layout

```
auto-pi/
├── config/        # default config + JSON-Schema
├── docs/          # user/operator documentation (github-token, ...)
├── extensions/    # Pi extensions: providers + harness commands + seed/doctor/loop
├── personas/      # fresh-session persona prompts (pm, engineer, review-engineer)
├── policies/      # cross-cutting policies excerpted into persona context
├── scripts/       # fallback Node CLI entries (seed/loop/stop/status/doctor)
├── skills/        # Pi skills shipped by the harness (budget-guard, ...)
├── templates/     # scaffold/context-pack templates
├── tests/         # harness unit tests (node --test)
└── ui/            # auto-pi monitor dashboard (Vite + React + TS + Tailwind)
```

## Monitoring the loop (auto-pi monitor)

The `ui/` directory contains a lightweight single-page dashboard that shows the
live status and progress of the loop: active persona, persona runs & outcomes,
LLM-provider health (success rate, retries, failures), persona health, a
progress-event timeline, and token usage.

```bash
npm run ui:server   # backend API on http://localhost:8787 (reads .pi/logs)
npm run ui:dev      # Vite dev server on http://localhost:5173
```

Open **http://localhost:5173**. The dashboard reads the deterministic,
structured ledgers the loop writes to the active project's `.pi/logs/`
(`events.jsonl`, `health.jsonl`, `runs.jsonl`, `errors.jsonl`, `usage.jsonl`).
See `ui/README.md` for details.

## Further reading

- [`docs/commands.md`](docs/commands.md) — command-by-command usage
- [`docs/configuration.md`](docs/configuration.md) — config reference & validation
- [`docs/personas.md`](docs/personas.md) — PM, Engineer, Review Engineer roles
- [`docs/github-pages.md`](docs/github-pages.md) — Pages deployment & health
- [`docs/telegram.md`](docs/telegram.md) — optional Telegram notifications
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common issues & fixes

## License

MIT — see [LICENSE](LICENSE).
