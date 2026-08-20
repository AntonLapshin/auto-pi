# extensions/doctor

Implements the `/loop-doctor` environment prerequisite check (M1).

- `core.js` — shared check logic (also imported by `scripts/doctor.js`). Each check
  returns a pass/fail result plus an actionable remediation hint on failure.
- `index.ts` — registers the `/loop-doctor` slash command, reusing `core.js` and passing
  the live Pi provider/model (from `ctx.model`) to the standalone detection.

Validated prerequisites: Node.js (>= 18), npm, git, GitHub CLI `gh`, `gh` auth,
GitHub token scopes (`repo`, `workflow`), Pi CLI, Pi model/provider, and the
`~/.auto-pi` workspace (writable). GitHub Pages readiness is reported as a
best-effort informational check.

Run it interactively as `/loop-doctor`, or from a shell as `npm run doctor` /
`node scripts/doctor.js` (the CLI exits non-zero if any required check fails).
