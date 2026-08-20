# GitHub Pages

How the auto-pi harness deploys the generated project to GitHub Pages (M4).

## Workflow

The scaffold generates two workflows:

- `.github/workflows/ci.yml` — lint + `test:coverage` + build + artifact.
- `.github/workflows/deploy-pages.yml` — the official GitHub Pages actions
  (configure-pages / upload-pages-artifact / deploy-pages) with `pages` +
  `id-token` permissions and a concurrency group.

The Vite `base` is set to `/{repo}/` and the README demo URL to
`https://{owner}.github.io/{repo}/`.

## Availability

GitHub Pages is only available for **public** repos on the free plan (Pro/Team
allow private Pages). At `/loop-seed`, a private repo triggers a warning that Pages
may be blocked. When deployment fails, the harness surfaces a
`pi:needs-human` + `pi:blocked` + `type:infra` issue instead of retrying forever.

## Checking deployment health

```bash
npm run pages            # check the active project's Pages deployment
npm run pages -- --repo owner/name   # check a specific repo
npm run pages -- --dry-run           # report without creating/updating issues
```

Exit codes: `0` healthy (or completed), `1` deployment failed, `2` error.

## Config

`config.pages` controls Pages behavior:

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enabled` | bool | `true` | enable GitHub Pages |
| `deployBranch` | string | `"gh-pages"` | Pages deploy branch |
