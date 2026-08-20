# Milestone 1: Environment Doctor

**Depends on:** Milestone 0
**Reference:** plan.md §3.3 (`/doctor`), §6.1 (prerequisites)

## Goal

Build the `/doctor` command (and `npm run doctor` fallback) that validates all environment prerequisites before any project work begins.

## Tasks

- [x] Implement `extensions/doctor/command.js` and `scripts/doctor.js` with shared core logic.
- [x] Checks to perform, each producing a clear pass/fail result:
  - [x] Node.js installed and version meets requirement
  - [x] npm installed
  - [x] git installed
  - [x] GitHub CLI `gh` installed
  - [x] `gh auth status` — authenticated to GitHub
  - [x] GitHub token scopes — has `repo` and `workflow` (read-only check via `gh auth status` or `gh api`)
  - [x] Pi CLI present and runnable
  - [x] Pi model/provider configured (detect active provider/model)
  - [x] Workspace directory `~/.auto-pi` exists and is writable
  - [x] GitHub Pages config readiness (best-effort)
- [x] Output a formatted report: each check with ✅/❌, and an overall summary line.
- [x] On failure, print actionable remediation hints (which tool to install, how to run `gh auth login`, which scopes to enable).
- [x] Implement `scripts/doctor.js` as the CLI entry (exit code non-zero if any required check fails).
- [x] Register `/doctor` in `package.json` `pi` block and in the extension `index.js`.

## Acceptance Criteria

```bash
npm run doctor
```

and `/doctor` both produce a clear pass/fail report for all prerequisites.

A clean machine shows exactly which prerequisites are missing and how to fix each.
