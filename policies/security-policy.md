# Security Policy

Security and secret-handling rules for the auto-pi harness and generated projects
(plan §7.2, §20, §25).

## Secret handling

- **Never leak secrets.** Tokens, API keys, bot tokens, chat IDs, and other
  credentials must never appear in logs, PR bodies, context packs, commits, or
  summaries.
- **Local secrets live in `.pi/local.json`** which is git-ignored and never
  committed. Values are read from environment variables at runtime.
- **`.pi/config.json` carries no secrets** — it is committed but contains only
  project config and env-var *names*, never values.
- **Redaction everywhere.** All log writes, summaries, and context packs pass
  through secret redaction (`redactSecrets` / `redactTelegram`) before reaching
  disk or GitHub.

## Review enforcement

The Review Engineer scans PRs for secret-like strings and raises
`PI-REVIEW type=secrets` when found.

## GitHub token

- Use `gh auth login` (or a PAT with `repo` + `workflow` scopes).
- Never write the token into versioned files; it is read from `GH_TOKEN` /
  `GITHUB_TOKEN` or gh's stored credentials.
