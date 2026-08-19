# Milestone 1: Environment Doctor

**Depends on:** Milestone 0
**Reference:** plan.md §3.3 (`/doctor`), §6.1 (prerequisites)

## Goal

Build the `/doctor` command (and `npm run doctor` fallback) that validates all environment prerequisites before any project work begins.

## Tasks

- [ ] Implement `extensions/doctor/command.js` and `scripts/doctor.js` with shared core logic.
- [ ] Checks to perform, each producing a clear pass/fail result:
  - Node.js installed and version meets requirement
  - npm installed
  - git installed
  - GitHub CLI `gh` installed
  - `gh auth status` — authenticated to GitHub
  - GitHub token scopes — has `repo` and `workflow` (read-only check via `gh auth status` or `gh api`)
  - Pi CLI present and runnable
  - Pi model/provider configured (detect active provider/model)
  - Workspace directory `~/.auto-pi` exists and is writable
  - GitHub Pages config readiness (best-effort)
- [ ] Output a formatted report: each check with ✅/❌, and an overall summary line.
- [ ] On failure, print actionable remediation hints (which tool to install, how to run `gh auth login`, which scopes to enable).
- [ ] Implement `scripts/doctor.js` as the CLI entry (exit code non-zero if any required check fails).
- [ ] Register `/doctor` in `package.json` `pi` block and in the extension `index.js`.

## Acceptance Criteria

```bash
npm run doctor
```

and `/doctor` both produce a clear pass/fail report for all prerequisites.

A clean machine shows exactly which prerequisites are missing and how to fix each.
