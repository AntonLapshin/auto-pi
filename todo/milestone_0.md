# Milestone 0: Harness Skeleton

**Depends on:** nothing
**Reference:** plan.md §2, §4, §5, §6, §28 "Milestone 0"

## Goal

Create the base `auto-pi` harness repository structure that can be installed into a Pi agent environment via `pi install`.

## Tasks

- [ ] Create the top-level `auto-pi/` repository directory structure:
  - `config/`
  - `extensions/`
  - `personas/`
  - `skills/`
  - `templates/`
  - `policies/`
  - `scripts/`
  - `docs/`
  - `tests/`
- [ ] Replace/add `package.json` with the harness manifest:
  - `name: auto-pi`
  - `description: Autonomous engineering team harness for Pi`
  - `type: module`
  - `pi` block registering commands (seed, stop, status, doctor) — adapt to actual Pi extension schema
  - `scripts` for fallback Node commands (seed, loop, stop, status, doctor, test)
  - dependencies: `@octokit/rest`, `execa`, `fs-extra`, `gray-matter`, `nanoid`, `zod`
- [ ] Update the Pi extension registration in `package.json` `pi` block to match the current repo's existing extension pattern (see `extensions/joingonka.ts`, `extensions/gonkaapi.ts` for the existing convention).
- [ ] Write top-level `README.md` covering:
  - Prerequisites: Linux, Node.js, npm, git, GitHub CLI `gh`, Pi, Pi model config, GitHub account
  - One active project per machine
  - Installation: `pi install /path/to/auto-pi`
  - GitHub Token setup (docs/token scopes, `gh auth login`)
- [ ] Add `.gitignore`.
- [ ] Add `LICENSE`.
- [ ] Add base `config/config.default.json` and `config/config.schema.json` (can be filled in detail in M5, but skeleton present now).
- [ ] Create stub directory files so empty dirs survive version control (e.g. `.gitkeep` or minimal README in each).

## Acceptance Criteria

```bash
pi install /path/to/auto-pi
```

activates the harness (commands present, no errors loading extensions).

The repository structure matches the layout in plan.md §4.
