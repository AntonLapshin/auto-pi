# Milestone 5: Project Config Copy

**Depends on:** Milestone 2
**Reference:** plan.md §7, §28 "Milestone 5"

## Goal

Copy default harness config into generated projects, filling in project-specific values, and set up the git-ignored local secrets structure.

## Tasks

- [ ] Finalize `config/config.default.json` with the full schema from plan.md §7.1 (project, pi, loop, limits, github, stack, quality, pages, notifications, logging).
- [ ] Finalize `config/config.schema.json` as a JSON-Schema for validation (used by the harness for config validation in M13 and by generated projects).
- [ ] Implement the config copy step in `extensions/seed/` (part of scaffold / start):
  - copy `config.default.json` to `{project}/.pi/config.json`
  - fill project values: project name, repo, owner, ownerEmail, demo URL, default branch
- [ ] Generate `{project}/.pi/local.example.json` (plan.md §7.2) documenting Telegram env-var pattern.
- [ ] Generate `{project}/.pi/config.schema.json` reference (`$schema` pointing relative to it).
- [ ] Add `.pi/local.json`, `.pi/logs/`, `.pi/state/` to the generated project's `.gitignore` (plan.md §20, and M5 requirement), while `.pi/config.json` remains committed.

## Acceptance Criteria

Generated repo contains `.pi/config.json` with correct project-specific values (project name, repo, owner, demo URL).

`.pi/local.json` and `.pi/logs/` are git-ignored. `.pi/config.json` is committed (no secrets).
