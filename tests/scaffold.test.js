/**
 * M3 scaffold tests.
 *
 * Verifies the template renderer (Jinja subset), the context builder, and that
 * scaffolding a project into a temp directory produces the expected file set
 * with the project identity injected.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  render,
  resolvePath,
  buildContext,
  scaffoldProject,
  listTemplates,
  templateDest,
  TEMPLATE_DIR,
} from "../extensions/seed/scaffold.js";

const CONTEXT = buildContext({
  projectName: "Build A Notes App",
  owner: "octocat",
  repo: "build-a-notes-app",
  description: "A markdown notes app",
});

test("resolvePath handles dotted paths and missing keys", () => {
  const ctx = { project: { name: "Notes" }, list: [1, 2] };
  assert.equal(resolvePath(ctx, "project.name"), "Notes");
  assert.equal(resolvePath(ctx, "missing.key"), undefined);
  assert.equal(resolvePath(ctx, "project"), ctx.project);
});

test("render substitutes variables and handles missing values", () => {
  assert.equal(render("Hello {{ project_name }}!", CONTEXT), "Hello Build A Notes App!");
  assert.equal(render("x={{ nope }}y", {}), "x=y", "missing vars render empty");
  assert.equal(render("{{ owner }}/{{ repo }}", CONTEXT), "octocat/build-a-notes-app");
});

test("render supports if/else truthiness", () => {
  assert.equal(render("{% if demo_url %}yes{% else %}no{% endif %}", CONTEXT), "yes");
  assert.equal(render("{% if missing %}yes{% else %}no{% endif %}", CONTEXT), "no");
  assert.equal(render("{% if demo_url %}yes{% endif %}", CONTEXT), "yes");
});

test("render supports for loops", () => {
  assert.equal(
    render("{% for x in items %}{{ x }};{% endfor %}", { items: ["a", "b"] }),
    "a;b;",
  );
  assert.equal(render("{% for x in empty %}x{% endfor %}", { empty: [] }), "");
});

test("render rejects unsupported tags", () => {
  assert.throws(() => render("{% set x = 1 %}", {}), /Unsupported template tag/);
});

test("buildContext computes demo URL and defaults", () => {
  const ctx = buildContext({
    projectName: "Demo",
    owner: "acme",
    repo: "demo-app",
  });
  assert.equal(ctx.demo_url, "https://acme.github.io/demo-app/");
  // M4: base path defaults to the Pages sub-path `/{repo}/`.
  assert.equal(ctx.base_path, "/demo-app/");
  assert.equal(ctx.description, "");

  // Explicit base path override is honored.
  const root = buildContext({ projectName: "Demo", owner: "acme", repo: "demo-app", basePath: "/" });
  assert.equal(root.base_path, "/");
});

test("listTemplates finds every .j2 file under the project template dir", async () => {
  const files = await listTemplates();
  assert.ok(files.length >= 20, "finds the full scaffold template set");
  assert.ok(files.some((f) => f.endsWith("package.json.j2")));
  assert.ok(files.some((f) => f.endsWith("src/core/projectInfo.ts.j2")));
});

test("templateDest maps a .j2 path to its destination", () => {
  const dir = TEMPLATE_DIR;
  assert.equal(templateDest(dir + "package.json.j2", dir), "package.json");
  assert.equal(
    templateDest(dir + "src/ui/components/DemoPanel.tsx.j2", dir),
    "src/ui/components/DemoPanel.tsx",
  );
});

test("scaffoldProject writes the full project with identity injected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-pi-scaffold-"));
  const res = await scaffoldProject(dir, CONTEXT);
  assert.equal(res.ok, true, `scaffold ok (errors: ${res.errors.join("; ")})`);
  assert.deepEqual(res.errors, []);

  // Core/UI split files exist.
  for (const rel of [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "tailwind.config.ts",
    "postcss.config.js",
    "index.html",
    ".gitignore",
    "README.md",
    "manifest.md",
    "project-state.md",
    "CHANGELOG.md",
    "src/main.tsx",
    "src/App.tsx",
    "src/core/projectInfo.ts",
    "src/ui/components/DemoPanel.tsx",
    "src/ui/viewModels/useProjectInfo.ts",
    "src/styles/index.css",
    "tests/core/projectInfo.test.ts",
  ]) {
    await access(join(dir, rel));
  }

  // M4: CI + Pages workflow files are generated into the repo.
  for (const rel of [".github/workflows/ci.yml", ".github/workflows/deploy-pages.yml"]) {
    await access(join(dir, rel));
  }
  const ci = await readFile(join(dir, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm run test:coverage/);
  assert.match(ci, /npm run build/);
  assert.match(ci, /actions\/upload-artifact/);
  const deploy = await readFile(join(dir, ".github/workflows/deploy-pages.yml"), "utf8");
  assert.match(deploy, /actions\/configure-pages/);
  assert.match(deploy, /actions\/upload-pages-artifact/);
  assert.match(deploy, /actions\/deploy-pages/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /concurrency/);

  // Identity is injected into the right places.
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.name, "build-a-notes-app");
  assert.equal(pkg.description, "A markdown notes app");

  const app = await readFile(join(dir, "src/App.tsx"), "utf8");
  assert.match(app, /Build A Notes App/);
  assert.match(app, /octocat/);
  assert.match(app, /build-a-notes-app/);

  const readme = await readFile(join(dir, "README.md"), "utf8");
  assert.match(readme, /Build A Notes App/);
  assert.match(readme, /https:\/\/octocat\.github\.io\/build-a-notes-app\//);

  // Core/UI split: the UI view model imports core, and DemoPanel has no logic.
  const vm = await readFile(join(dir, "src/ui/viewModels/useProjectInfo.ts"), "utf8");
  assert.match(vm, /core\/projectInfo/);

  // Coverage is configured to enforce 100% on src/core only.
  const viteCfg = await readFile(join(dir, "vite.config.ts"), "utf8");
  assert.match(viteCfg, /src\/core\/\*\*\/\*\.ts/);
  assert.match(viteCfg, /thresholds/);
  // M4: Vite base path is injected as the Pages sub-path `/{repo}/`.
  assert.match(viteCfg, /base = "\/build-a-notes-app\/"|base: "\/build-a-notes-app\/"/);
});

test("scaffoldProject reports errors when the template dir is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-pi-scaffold-"));
  const res = await scaffoldProject(dir, CONTEXT, {
    templateDir: join(dir, "does-not-exist"),
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.length > 0);
});

test("humanizeName converts a repo slug to a friendly title", async () => {
  const { humanizeName } = await import("../extensions/seed/core.js");
  assert.equal(humanizeName("build-a-notes-app"), "Build A Notes App");
  assert.equal(humanizeName("My_App"), "My App");
  assert.equal(humanizeName("notes"), "Notes");
});
