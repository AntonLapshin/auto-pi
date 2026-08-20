# docs/github-token

GitHub access for the auto-pi harness is provided by the GitHub CLI (`gh`) and/or a
personal access token (PAT). The harness requires a token able to create repositories,
issues, pull requests, and workflow runs — see the scopes below.

## Recommended setup: `gh auth login`

The harness primarily uses the GitHub CLI for authentication. Login once:

```bash
gh auth login        # follow the interactive prompts (HTTPS, browser)
gh auth status       # verify you are authenticated
```

## Token scopes

When `gh auth login` is used with a browser flow, `gh` requests the required scopes
automatically. To use a classic PAT directly (e.g. `GH_TOKEN` / `GITHUB_TOKEN`
environment variable), the token must have at least these scopes:

| Scope      | Needed for                                                   |
|------------|--------------------------------------------------------------|
| `repo`     | create/clone repos, issues, PRs, force-push, local branches  |
| `workflow` | create/update GitHub Actions workflow files via the API      |

Check which scopes your current token has:

```bash
gh api user -q '.login'
gh auth status          # shows the scopes gh has on your behalf
```

For fine-grained PATs, grant **Repository access** to the target repos and these
permissions: *Contents (write)*, *Issues (write)*, *Pull requests (write)*,
*Workflows (write)*, *Pages (write)*, *Actions (read)*.

## Environment variables

The harness reads the token from `GH_TOKEN` / `GITHUB_TOKEN` (gh falls back to these)
or from `gh auth login`'s stored credentials. Keep the token out of any versioned
files — it is never written to `.pi/config.json` or project files, only to the
git-ignored `.pi/local.json` (M5).
