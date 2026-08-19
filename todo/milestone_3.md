# Milestone 3: React/Tailwind Project Scaffold

**Depends on:** Milestone 2
**Reference:** plan.md §8.6, §19, §26, §28 "Milestone 3"

## Goal

Build the scraffolding that generates a demoable, testable React + Tailwind + TypeScript project inside the created repo.

## Tasks

- [ ] Implement `extensions/seed/scaffold.js` using the Jinja/`*.j2` templates in `templates/project/`.
- [ ] Generate the base project files listed in plan.md §8.6:
  - `package.json` (scripts: dev, build `tsc && vite build`, preview, lint, test, test:coverage)
  - `tsconfig.json`
  - `vite.config.ts` (with base path placeholder)
  - `tailwind.config.ts`
  - `postcss.config.js`
  - `index.html`
  - `.gitignore`
  - `README.md` (see §9)
  - `manifest.md`, `project-state.md`, `CHANGELOG.md` (templates)
- [ ] Generate `src/` layout enforcing the core/UI split:
  - `src/main.tsx`, `src/App.tsx`
  - `src/core/projectInfo.ts`
  - `src/ui/components/DemoPanel.tsx`
  - `src/ui/viewModels/useProjectInfo.ts`
  - `src/styles/index.css` with `@tailwind` directives
- [ ] Generate `tests/core/projectInfo.test.ts` covering the core module.
- [ ] Configure Vitest coverage enforcing 100% on `src/core/**/*.ts` only (plan.md §19.1).
- [ ] Generate an initial demo panel that renders project name / status / demo info (plan.md §26.3).
- [ ] Inject the project name into templates during scaffolding.
- [ ] Verify scaffold succeeds locally:
  ```bash
  npm install
  npm test
  npm run build
  ```
  all pass before commit.

## Acceptance Criteria

```bash
npm install && npm test && npm run build
```

all pass in a freshly generated project.

Core/UI separation is in place; `src/core` has 100% coverage on its initial module; UI contains no business logic.
