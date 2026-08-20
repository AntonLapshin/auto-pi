# Milestone 4: GitHub Actions CI & Pages Deployment

**Depends on:** Milestone 3
**Reference:** plan.md §11, §12, §29.1, §28 "Milestone 4"

## Goal

Add CI and GitHub Pages deployment to generated projects, including Vite base path and demo URL injection and failure handling.

## Tasks

- [x] Generate `.github/workflows/ci.yml` (plan.md §11.1): checkout, setup-node, `npm ci`, lint, test:coverage, build, upload dist artifact.
- [x] Generate `.github/workflows/deploy-pages.yml` (plan.md §12.3) using the official actions (configure-pages, upload-pages-artifact, deploy-pages) with pages/id-token permissions and concurrency group.
- [x] Inject Vite `base: "/{repo}/"` into `vite.config.ts` during scaffolding (plan.md §12.2).
- [x] Inject demo URL `https://{owner}.github.io/{repo}/` into README during scaffolding.
- [x] Implement Pages failure handling (plan.md §12.4, §29.1):
  - warn during `/loop-seed` about private-repo/plan Pages limitations
  - detect deployment failure (via workflow run status check)
  - do not retry forever
  - create/update `pi:needs-human` + `pi:blocked` + `type:infra` issue with `PI-HUMAN` marker
  - log `reason=github_pages_deployment_failed`
- [x] Implement a helper to read the latest workflow run status for the deploy workflow.

## Acceptance Criteria

- Push to `main` triggers CI (lint + test + coverage + build).
- Push to `main` triggers Pages deploy.
- README contains the correct demo URL.
- If Pages is blocked by GitHub plan/visibility, a `pi:needs-human` issue is created instead of infinite retry.
