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

After installation, the following commands are available (interactively as
`/loop-seed`, `/loop-stop`, `/loop-status`, `/loop-logs`, `/loop-resume`, `/loop-sync-config`, `/loop-doctor`):

| Command | Purpose | Milestone |
|---------|---------|-----------|
| `/loop-seed` | Initiate a new project (clarify, create repo, scaffold) | M2 |
| `/loop-stop` | Stop the autonomous loop | M6 |
| `/loop-status` | Active project, loop, and persona status | M13 |
| `/loop-logs` | Show the latest local logs | M13 |
| `/loop-resume` | Resume a stopped/paused project's loop | M13 |
| `/loop-sync-config` | Recopy config defaults, preserving project values | M13 |
| `/loop-doctor` | Validate environment prerequisites | M1 |

Each command also has a fallback `npm run <cmd>` / `node scripts/<cmd>.js`
entry for non-interactive use (see [`scripts/`](../scripts/README.md)).

## Next steps

See [configuration.md](configuration.md) for the project config reference and
[commands.md](commands.md) for full command docs.
