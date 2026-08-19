# Milestone 2: `/seed` Initiation & Repo Creation

**Depends on:** Milestone 0, Milestone 1
**Reference:** plan.md §2.2, §3.1, §8.1–8.5, §28 "Milestone 2"

## Goal

Build the initiation portion of `/seed`: clarification, repo naming, repo existence check, GitHub repo creation, and local workspace creation. (Project scaffolding is a later milestone.)

## Tasks

### Clarification
- [ ] Implement `extensions/seed/clarify.js`: ask 3–6 high-value questions based on the project description.
- [ ] Support the "use assumptions" escape hatch to proceed automatically.
- [ ] Store clarification state in `{workspace}/.pi/state/initiation.json` (see plan.md §8.2 schema).

### Repo naming
- [ ] Implement `extensions/seed/repo-name.js`:
  - derive repo name from description (lowercase, hyphen-separated, no spaces/special chars, no GitHub reserved words)
  - check existence via GitHub API/gh
  - if exists, try `{name}-app`, then `{name}-{shortid}`, then ask the user
- [ ] Respect `config.github.autoCreateRepo` for automatic alternative acceptance.

### Repo creation + workspace
- [ ] Create GitHub repo via `gh repo create {owner}/{repo} --private|--public`.
- [ ] Clone repo into workspace `{workspace}/{repo}` (or `~/auto-pi/workspaces/{repo}/repo`).
- [ ] Create `.pi/` state directory inside the workspace.
- [ ] Enforce "one active project per machine":
  - read `~/.auto-pi/current-project.json`
  - if another project is active, refuse with the message from plan.md §2.2 and exit
  - otherwise write `current-project.json` with projectName, repo, workspace, startedAt, status.

## Acceptance Criteria

```text
/seed Build a markdown notes app
```

runs a clarification, proposes/creates a repo (or asks for confirmation), clones it locally, and records the active project state.

Re-running `/seed` while another project is active is refused with a clear message.
