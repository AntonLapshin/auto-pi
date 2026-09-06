# Milestone 5: Project Config Copy

**Depends on:** Milestone 2
**Reference:** original build plan (§7, §28 "Milestone 5"; historical — canonical docs: README.md, docs/architecture.md, docs/commands.md)

## Goal

Copy default harness config into generated projects, filling in project-specific values, and set up the git-ignored local secrets structure.

## Tasks

- [x] Finalize `config/config.default.json` with the full schema from original plan §7.1 (project, pi, loop, limits, github, stack, quality, pages, notifications, logging).
- [x] Finalize `config/config.schema.json` as a JSON-Schema for validation (used by the harness for config validation in M13 and by generated projects).
- [x] Implement the config copy step in `extensions/seed/` (part of scaffold / start):
  - copy `config.default.json` to `{project}/.pi/config.json`
  - fill project values: project name, repo, owner, ownerEmail, demo URL, default branch
- [x] Generate `{project}/.pi/local.example.json` (original plan §7.2) documenting Telegram env-var pattern.
- [x] Generate `{project}/.pi/config.schema.json` reference (`$schema` pointing relative to it).
- [x] Add `.pi/local.json`, `.pi/logs/`, `.pi/state/` to the generated project's `.gitignore` (original plan §20, and M5 requirement), while `.pi/config.json` remains committed.

## Acceptance Criteria

Generated repo contains `.pi/config.json` with correct project-specific values (project name, repo, owner, demo URL).

`.pi/local.json` and `.pi/logs/` are git-ignored. `.pi/config.json` is committed (no secrets).
