# Installation

How to install and activate the auto-pi harness in your Pi environment.

## Prerequisites

- **Linux** (the harness and its shell tooling target Linux; macOS is not
  currently supported).
- **Node.js** (≥ 18) and **npm**.
- **git**.
- **GitHub CLI `gh`** — used for authentication, repo creation, and API calls.
- **Pi** (`@earendil-works/pi-coding-agent`) — the coding agent the harness
  builds on.
- **Pi model configuration** — at least one provider/model configured for Pi
  (e.g. the bundled `joingonka` / `gonkaapi` providers). Set the matching API
  key env var.
- **GitHub account** — with a token that can create repos, issues, PRs, and
  workflow runs. See [GitHub Token setup](github-token.md).

Run `/loop-doctor` (or `npm run doctor`) to validate all prerequisites — it reports
exactly what is missing and how to fix it.

## Install

Install the harness into your Pi environment by pointing `pi install` at this
repo (local path, git URL, or npm spec):

```bash
pi install /path/to/auto-pi
```

Pi registers the package's extensions from the `pi` block in `package.json`,
which loads the provider extensions and the harness slash commands.

## Verify

After installation, all 11 slash commands are available (see
[commands.md](commands.md) for full usage):

| Command | Purpose |
|---------|---------|
| `/loop-seed` | Spin up a new project (clarify, create repo, scaffold, start loop) |
| `/loop-pull` | Continue an existing project on this machine from its GitHub repo |
| `/loop-stop` | Pause the autonomous loop (project stays active) |
| `/loop-restart` | Safely restart the autonomous loop (stop, then start again) |
| `/loop-switch` | Switch the active project to another locally-seeded project |
| `/loop-status` | Active project, loop, and persona status |
| `/loop-logs` | Show the latest local logs |
| `/loop-resume` | Resume a stopped/paused project's loop |
| `/loop-sync-config` | Recopy config defaults, preserving project values |
| `/loop-provider` | Show or switch the loop's LLM provider/model (restarts the loop) |
| `/loop-doctor` | Validate environment prerequisites |

Plus `/loop` (start/report the autonomous loop). To verify, start Pi and
confirm `/loop-seed`, `/loop-pull`, `/loop-stop`, `/loop-status`,
`/loop-doctor` show up in `/`-command completion.

Each command also has a fallback `npm run <cmd>` / `node scripts/<cmd>.js`
entry for non-interactive use (see [`scripts/`](../scripts/README.md)).

## Next steps

See [configuration.md](configuration.md) for the project config reference and
[commands.md](commands.md) for full command docs.
