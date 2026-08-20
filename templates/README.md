# templates

Prompt / document templates used by the harness when scaffolding a project and
building persona context packs.

## `project/`

Jinja-style (`*.j2`) templates rendered by `extensions/seed/scaffold.js` (M3) to
generate a demoable React + Tailwind + TypeScript project inside the freshly
created repo. The renderer supports `{{ var }}`, `{% if %}...{% else %}...{% endif %}`,
and `{% for x in list %}...{% endfor %}` (a dependency-free subset of Jinja).

A template's destination path is its filename with `.j2` stripped
(`package.json.j2` → `package.json`).

Context passed to every template (see `buildContext` in `scaffold.js`):

| Variable       | Meaning                                   |
|----------------|-------------------------------------------|
| `project_name` | human-friendly project name               |
| `owner`        | GitHub owner                              |
| `repo`         | repo slug                                 |
| `description`  | one-line project description              |
| `base_path`    | Vite base path (defaults to `/{repo}/`, M4)|
| `demo_url`     | GitHub Pages demo URL for the project     |

The scaffold also generates CI + Pages workflows (M4):

- `.github/workflows/ci.yml` — checkout, setup-node, `npm ci`, lint,
  test:coverage, build, upload `dist` artifact.
- `.github/workflows/deploy-pages.yml` — official configure-pages /
  upload-pages-artifact / deploy-pages actions with `pages` + `id-token`
  permissions and a `concurrency` group.

Later milestones add context-pack templates here (M7/M8/M9).
