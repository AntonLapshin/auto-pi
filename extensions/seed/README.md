# extensions/seed

Implements the `/loop-seed` initiation flow (M2).

- `core.js` — shared orchestration (also imported by `scripts/seed.js`): enforces
  **one active project per machine** (stopping the currently-active project's loop
  first so the new seed becomes active), runs *agentic* clarification, derives &
  checks repo names (with `{name}-app` / `{name}-{shortid}` fallbacks), creates the
  GitHub repo via `gh repo create`, clones it into the workspace, **scaffolds the
  React/Tailwind/TS project** (M3), **copies the project config** into
  `.pi/config.json` + generates the local-secrets scaffold (M5), writes
  `.pi/state/initiation.json`, and records `~/.auto-pi/current-project.json`.
- `agentic-clarify.js` — (new, primary path) runs a fresh `pi -p` batch session that
  evaluates the specific idea and emits the follow-up questions that resolve its
  ambiguity, then parses/validates them into the canonical question shape. Falls
  back to `clarify.js`'s generic questions when the agent is unavailable. The
  **only** hardcoded question in `/loop-seed` is the project name (command layer).
- `agentic-manifest.js` — (new) a second LLM step *after* clarification: runs a fresh
  `pi -p` batch session that evaluates the idea + the user's clarification answers and
  produces the real `manifest.md` — purpose, goals, non-goals, success criteria, and a
  **milestone roadmap** — which becomes the backbone of the project. The PM persona
  reads `manifest.md` to plan issues/milestones, so this makes the user's answers
  actually shape what gets built. Falls back to the deterministic template manifest
  (which already reflects the clarification answers) when the agent is unavailable.
- `clarify.js` — minimal idea-agnostic fallback question set used only when the
  agent cannot run, plus `applyAnswers` (with a "use assumptions" escape hatch).
  UI-agnostic.
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

## Manifest generation (the project backbone)

After clarification, `/loop-seed` runs a second agentic step (`agentic-manifest.js`):
a fresh `pi` architect persona evaluates the idea **plus the user's clarification
answers** and writes the real `manifest.md` with a milestone roadmap (`M1`, `M2`, …).
This is what makes the answers matter — the PM persona reads `manifest.md` to plan
issues and milestones, so the user's requirements drive the implementation. When the
agent is unavailable, the deterministic template manifest (which already embeds the
clarification answers) is used instead. Set `generateManifest:false` (or inject
`executeManifest`) to disable/override for tests.

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
