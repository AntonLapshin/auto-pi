# auto-pi

**Autonomous engineering team harness for Pi.**

`auto-pi` turns a Pi agent into an autonomous engineering team that seeds a project,
creates a GitHub repo, and runs a loop of fresh persona sessions (PM, Engineer,
Review Engineer) that build, test, review, and ship the project — all the way to a
deployed GitHub Pages demo — with minimal human supervision.

> This repository is the harness itself. `pi install /path/to/auto-pi` activates it
> inside your Pi agent environment.

## Status

Milestones 0–9 are in place: the harness skeleton, the `/doctor` environment
prerequisite check (M1), the `/seed` initiation flow — clarification, repo
naming & creation, local workspace, and one-project-per-machine enforcement
(M2) — the React/Tailwind/TypeScript project scaffold (M3), the CI & GitHub
Pages deployment workflows (M4), and the project config copy into
`.pi/config.json` + the git-ignored local-secrets scaffold (M5), the loop
orchestrator (M6), the PM persona (M7), and the Engineer persona (M8) — issue
implementation, testing, PR creation, review-comment addressing, and squash
merge. The Review Engineer persona (M9) — PR verification with physically
verifiable evidence, missing-test detection, and approve/request-changes flow —
is implemented. Local logging and execution summary (M10) — `runs.jsonl`,
`errors.jsonl`, `summary.md`/`summary.jsonl`, `latest.log`, per-day/per-cycle
token accounting, secret redaction, and config-driven rotation — is implemented.
Optional Telegram lifecycle notifications (M11) — `skills/telegram-notify`
project-done / needs-human / budget-stop / manual-stop messages, env-driven
config, non-fatal when disabled or env vars are absent, and secret redaction —
is implemented.

**Milestone 12 (pilot) — run end-to-end.** A real pilot was run on the canonical
example ("Build a markdown notes app with tags and search"): doctor passed,
`/seed` created the repo + scaffold + config and started the loop, the PM
planned and filed issues, the Engineer implemented and opened PRs, the Review
Engineer verified and approved, the Engineer squash-merged, CI stayed green
with 100% core coverage, local logs were written with no secrets, and the
project was marked `done`. GitHub Pages (not available for private repos on the
free plan) was handled as `pi:needs-human`. One-project-per-machine and the
`/stop` path were verified. See [`docs/pilot-report.md`](docs/pilot-report.md)
for the full pilot log and the hardening recommendations it surfaced (M13).

The remaining loop commands report "not implemented" until
later milestones fill them in. See
[`todo/README.md`](todo/README.md) for the milestone plan.

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

Run `/doctor` (or `npm run doctor`) to validate all prerequisites — it reports
exactly what is missing and how to fix it (implemented in M1).

## One active project per machine

The harness enforces **exactly one active project per machine** at a time. This keeps
the loop's state, lock file, and budget accounting unambiguous. `/seed` refuses to run
while another project is active, with a clear message. See
[`extensions/seed`](extensions/seed) (M2) for the enforcement logic.

## Installation

Install the harness into your Pi environment by pointing `pi install` at this repo
(local path, git URL, or npm spec are all supported by Pi packages):

```bash
pi install /path/to/auto-pi
```

Pi registers the package's extensions from the `pi` block in `package.json`, which
loads the provider extensions and the harness slash commands. After installation the
following commands are available (interactively as `/seed`, `/stop`, `/status`,
`/doctor`):

| Command    | Purpose                                      | Milestone |
|------------|----------------------------------------------|-----------|
| `/seed`    | Initiate a new project (clarify, create repo, scaffold) | M2 |
| `/stop`    | Stop the autonomous loop                     | M6        |
| `/status`  | Active project, loop, and persona status     | M13       |
| `/doctor`  | Validate environment prerequisites           | M1 (implemented) |

Each command also has a fallback `npm run <cmd>` / `node scripts/<cmd>.js` entry for
non-interactive use (see [`scripts/`](scripts)).

> **Note on commands in `package.json`:** Pi registers slash commands
> programmatically via `pi.registerCommand()` in an extension
> (`extensions/harness.ts` for `/seed`, `/stop`, `/status`; `extensions/doctor`
> for `/doctor`) — the `pi` block in `package.json` only declares resource
> directories, matching the existing repo convention.

To verify the installation loaded cleanly:

```bash
pi --version
```

then start Pi and confirm `/seed`, `/stop`, `/status`, `/doctor` show up in
`/`-command completion.

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
git-ignored `.pi/local.json` of the generated project (M5) or in environment
variables.

## Repository layout

```
auto-pi/
├── config/        # default config + JSON-Schema (M5)
├── docs/          # user/operator documentation (github-token, ...)
├── extensions/    # Pi extensions: providers + harness commands + seed/doctor/loop
├── personas/      # fresh-session persona prompts (pm, engineer, review-engineer)
├── policies/      # cross-cutting policies excerpted into persona context
├── scripts/       # fallback Node CLI entries (seed/loop/stop/status/doctor)
├── skills/        # Pi skills shipped by the harness (budget-guard, ...)
├── templates/     # scaffold/context-pack templates
├── tests/         # harness unit tests (node --test)
└── LICENSE, README.md, package.json, .gitignore
```

## License

MIT — see [LICENSE](LICENSE).
