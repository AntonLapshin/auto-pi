# extensions/seed

Implements the `/loop-seed` initiation flow (M2).

- `core.js` — shared orchestration (also imported by `scripts/seed.js`): enforces
  **one active project per machine** (stopping the currently-active project's loop
  first so the new seed becomes active), runs clarification, derives & checks repo
  names (with `{name}-app` / `{name}-{shortid}` fallbacks), creates the GitHub
  repo via `gh repo create`, clones it into the workspace, **scaffolds the
  React/Tailwind/TS project** (M3), **copies the project config** into
  `.pi/config.json` + generates the local-secrets scaffold (M5), writes
  `.pi/state/initiation.json`, and records `~/.auto-pi/current-project.json`.
- `config.js` — project config copy (M5): loads `config/config.default.json`,
  fills the `project` section (name, repo, owner, ownerEmail, demo URL, default
  branch), and writes `{project}/.pi/config.json` (committed), plus the
  git-ignored local-secrets scaffold — `.pi/local.example.json` (Telegram
  env-var pattern) and `.pi/config.schema.json` (relative schema reference).
- `clarify.js` — builds 3–6 high-value questions from the project description and
  applies answers (with a "use assumptions" escape hatch). UI-agnostic.
- `repo-name.js` — derives a GitHub repo slug from the description, checks
  existence via `gh`, and generates fallback names. Handles reserved words.
- `constants.js` — shared paths (`~/.auto-pi`, `current-project.json`, workspaces)
  and state-schema constants.
- `scaffold.js` — renders the `templates/project/*.j2` templates into the cloned
  repo to generate the React + Tailwind + TypeScript project (M3). Includes a
  small dependency-free Jinja-subset renderer (`{{ var }}`, `{% if %}`, `{% for %}`).
  Injects the Vite `base: "/{repo}/"` path and the GitHub Pages demo URL (M4).
- `deploy.js` — GitHub Pages deployment helpers (M4): reads the latest run status
  of the Pages deploy workflow, detects a failed deployment, and creates/updates a
  `pi:needs-human` + `pi:blocked` + `type:infra` issue (with a `PI-HUMAN` marker)
  instead of retrying forever. Logs `reason=github_pages_deployment_failed`.
- `index.ts` — registers the `/loop-seed` slash command, injecting live Pi UI dialogs
  (`ctx.ui.confirm/select/input`) as the `io` handlers for `core.js`.

Run it interactively as `/loop-seed <description>` (it also asks for an explicit
project name used for the repo slug and display name), or from a shell as
`npm run seed -- "<description>"` (the CLI prompts over stdin, including the
project name; add `--yes` to proceed non-interactively with assumptions).

## GitHub Pages (M4)

Scaffolding generates `.github/workflows/ci.yml` (lint + test:coverage + build +
artifact) and `.github/workflows/deploy-pages.yml` (official configure-pages /
upload-pages-artifact / deploy-pages actions with `pages` + `id-token` permissions
and a concurrency group). The Vite `base` is set to `/{repo}/` and the README demo
URL to `https://{owner}.github.io/{repo}/`.

During `/loop-seed`, a private repo triggers a warning that Pages is only available for
public repos on the free plan. Deployment health can be checked from a shell with
`npm run pages` (see `scripts/pages.js`); it surfaces failures as a
`pi:needs-human` issue rather than retrying forever.
