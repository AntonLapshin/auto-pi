# config

Harness configuration.

| File | Purpose |
|------|---------|
| `config.default.json` | Default project configuration, copied to `{project}/.pi/config.json` at seed time (M5), with the `project` section filled in. |
| `config.schema.json` | JSON-Schema describing `config.default.json` — used for validation (M5, M13). |

This directory is version-controlled (no secrets). Local secrets live in the generated project's
`.pi/local.json` which is git-ignored (M5); the committed `.pi/config.json` carries no secrets.

## Project config copy (M5)

At `/seed` time the harness copies `config.default.json` to `{project}/.pi/config.json` and fills
in the `project` section (name, repo, owner, ownerEmail, demo URL, default branch). It also
generates:

- `{project}/.pi/local.example.json` — documented template for the git-ignored `.pi/local.json`
  (Telegram env-var pattern, see M11);
- `{project}/.pi/config.schema.json` — JSON-Schema reference for validating `.pi/config.json`.

`.pi/local.json`, `.pi/logs/`, and `.pi/state/` are git-ignored in the generated project; `.pi/config.json`
is committed. See `extensions/seed/config.js` (M5) for the implementation.
