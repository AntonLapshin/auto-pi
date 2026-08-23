# extensions/pull

Implements the `/loop-pull` command — **continue an existing auto-pi project on
this machine** from its GitHub repo. This is the "different machine" companion
to `/loop-seed`: seed a project on machine A, then `pi install /path/to/auto-pi`
and `/loop-pull <repo-url>` on machine B to pick it up exactly where it left off.

## Why this exists

When you `/loop-seed` a project, the repo on GitHub contains the project code
plus the **committed** `.pi/config.json`. The per-machine local state —
`.pi/state/`, `.pi/logs/`, `.pi/runs/`, `.pi/local.json` — is git-ignored and
stays on the machine it was seeded on.

To continue on another machine, `/loop-pull`:

1. parses the repo reference (GitHub URL, `owner/repo`, or SSH URL);
2. verifies the repo exists (`gh repo view`);
3. stops the currently-active project's loop (if any) — matching `/loop-seed`;
4. clones the repo into the **same** `~/.auto-pi/workspaces/{owner}/{repo}/repo`
   layout `/loop-seed` uses;
5. verifies it is an auto-pi project (committed `.pi/config.json`);
6. **recreates the git-ignored `.pi/state/initiation.json` marker** — the
   loop-recognition helpers (`listProjects` / `resolveProject` in
   `extensions/loop/orchestrator.js`) require this file to treat a workspace as
   a locally-seeded project, so it is regenerated from the committed config;
7. records it as the **active** project (`~/.auto-pi/current-project.json`);
8. starts the loop.

After `/loop-pull`, every other auto-pi command works exactly as if the project
had been seeded here: `/loop-switch`, `/loop-status`, `/loop-logs`,
`/loop-restart`, `/loop`, etc.

## Files

- `core.js` — shared orchestration (also imported by `scripts/pull.js`):
  `parseRepoRef` (URL/owner-repo/SSH parsing), `repoInfo` (gh existence check),
  `workspaceFor` (seed-compatible path), `cloneProject`, `readProjectConfig`,
  `ensureInitiationState` (recreates the git-ignored initiation marker), and
  `runPull` (the full flow).
- `index.ts` — registers the `/loop-pull` slash command, injecting live Pi UI
  dialogs (confirm + notify).

## CLI / commands

- `npm run pull` (or `node scripts/pull.js`) — same flow non-interactively.
  Flags: `--no-start` (pull + record active but don't start the loop),
  `--yes` (skip the confirmation prompt).
- `/loop-pull <repo-url>` interactive command registered here.
