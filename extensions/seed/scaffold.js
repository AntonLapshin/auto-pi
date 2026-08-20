/**
 * Scaffold generator for the auto-pi `/loop-seed` flow (M3).
 *
 * Generates a demoable, testable React + Tailwind + TypeScript project inside
 * the freshly-cloned repo, using the Jinja-style `*.j2` templates in
 * `templates/project/`. The scaffold enforces the core/UI split (plan.md §19.1):
 * business logic lives in `src/core` (100% test coverage), the UI stays thin.
 *
 * Plain JS on purpose — imported by `extensions/seed/core.js` (via jiti) and
 * directly by tests. No third-party template engine is required: the renderer
 * below supports the small Jinja subset the templates actually use:
 *
 *   - `{{ expr }}`              variable substitution (dotted paths)
 *   - `{% if expr %}...{% else %}...{% endif %}`   truthiness branching
 *   - `{% for x in expr %}...{% endfor %}`         iteration over arrays
 *
 * A template file's destination path is its filename with the `.j2` extension
 * stripped (e.g. `package.json.j2` → `package.json`). Files are written
 * relative to the target directory (the project workspace).
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";

/** Directory that holds the `*.j2` project templates. */
export const TEMPLATE_DIR = new URL("../../templates/project/", import.meta.url).pathname;

/** Strip a leading `./` from a relative path for display / mapping. */
function normalizeRel(rel) {
  return rel.replace(/^\.\//, "");
}

/**
 * Resolve a dotted path (e.g. `project.name`) against a context object.
 * Returns `undefined` for missing keys.
 */
export function resolvePath(context, path) {
  let value = context;
  for (const key of path.split(".")) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * Render a template string using the supported Jinja subset.
 *
 * @param {string} template raw template text
 * @param {object} context  variable map available to the template
 * @returns {string} rendered output
 */
export function render(template, context) {
  // Split on tags while preserving the text between them.
  const tokens = template.split(/({{.*?}}|{%.*?%})/gs);
  return renderTokens(tokens, context);
}

/** Recursively render a token array, honoring if/for blocks. */
function renderTokens(tokens, context) {
  let out = "";
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) {
      i += 1;
      continue;
    }
    if (token.startsWith("{{") && token.endsWith("}}")) {
      const expr = token.slice(2, -2).trim();
      const value = resolvePath(context, expr);
      out += value == null ? "" : String(value);
      i += 1;
    } else if (token.startsWith("{%") && token.endsWith("%}")) {
      const tag = token.slice(2, -2).trim();
      if (tag.startsWith("if ")) {
        const cond = tag.slice(3).trim();
        const block = collectBlock(tokens, i, "if");
        i = block.end;
        if (resolvePath(context, cond)) {
          out += renderTokens(block.body, context);
        } else if (block.elseBody) {
          out += renderTokens(block.elseBody, context);
        }
      } else if (tag.startsWith("for ")) {
        const match = /^for\s+(\w+)\s+in\s+([\w.]+)\s*$/.exec(tag);
        if (!match) throw new Error(`Unsupported for tag: ${tag}`);
        const [, varName, iterExpr] = match;
        const block = collectBlock(tokens, i, "for");
        i = block.end;
        const items = resolvePath(context, iterExpr) || [];
        for (const item of items) {
          out += renderTokens(block.body, { ...context, [varName]: item });
        }
      } else {
        throw new Error(`Unsupported template tag: ${tag}`);
      }
    } else {
      out += token;
      i += 1;
    }
  }
  return out;
}

/**
 * Collect the body of a block starting at the opening tag at index `start`.
 * Returns { body, elseBody, end } where `end` is the index just past the
 * matching `{% endX %}` tag.
 */
function collectBlock(tokens, start, kind) {
  const openTag = tokens[start];
  const closeTag = `{% end${kind} %}`;
  const elseTag = `{% else %}`;
  let depth = 0;
  let elseIndex = -1;
  for (let j = start + 1; j < tokens.length; j += 1) {
    const t = tokens[j];
    if (t.startsWith("{%") && t.endsWith("%}")) {
      const tag = t.slice(2, -2).trim();
      if (tag.startsWith(`if `) || tag.startsWith(`for `)) depth += 1;
      else if (tag === `end${kind}`) {
        if (depth === 0) {
          return {
            body: tokens.slice(start + 1, elseIndex === -1 ? j : elseIndex),
            elseBody: elseIndex === -1 ? null : tokens.slice(elseIndex + 1, j),
            end: j + 1,
          };
        }
        depth -= 1;
      } else if (tag === "else" && depth === 0) {
        elseIndex = j;
      }
    }
  }
  // Defensive: if we never find the end tag, treat the rest as the body.
  return { body: tokens.slice(start + 1), elseBody: null, end: tokens.length };
}

/**
 * Build the render context for a project scaffold.
 *
 * @param {object} opts
 * @param {string} opts.projectName human-friendly project name
 * @param {string} opts.owner       GitHub owner
 * @param {string} opts.repo        repo (slug) name
 * @param {string} [opts.description] one-line project description
 * @param {string} [opts.basePath]  Vite base path; defaults to `/{repo}/` (M4) so
 *                                  the built demo resolves under GitHub Pages.
 * @returns {object} context passed to every template
 */
export function buildContext({
  projectName,
  owner,
  repo,
  description = "",
  basePath,
}) {
  // M4: the Vite base defaults to the Pages sub-path `/{repo}/` so asset URLs
  // resolve correctly under https://{owner}.github.io/{repo}/. A caller may
  // override it (e.g. `/` for a project served from a custom root domain).
  const effectiveBasePath = basePath ?? `/${repo}/`;
  const demoUrl = `https://${owner}.github.io/${repo}/`;
  return {
    project_name: projectName,
    owner,
    repo,
    description,
    base_path: effectiveBasePath,
    demo_url: demoUrl,
  };
}

/**
 * Recursively collect all `*.j2` template files under a directory.
 * @param {string} dir absolute directory to scan
 * @returns {Promise<string[]>} absolute paths to every `.j2` file
 */
export async function listTemplates(dir = TEMPLATE_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTemplates(full)));
    } else if (entry.name.endsWith(".j2")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Map an absolute template path to its destination path relative to the
 * project root (the `.j2` extension stripped).
 */
export function templateDest(templatePath, templateDir = TEMPLATE_DIR) {
  const rel = templatePath.slice(templateDir.length);
  return normalizeRel(rel.slice(0, -extname(rel).length));
}

/**
 * Render a single template file into its destination string.
 * @returns {Promise<{ dest: string, content: string }>}
 */
export async function renderTemplate(templatePath, context, templateDir = TEMPLATE_DIR) {
  const source = await readFile(templatePath, "utf8");
  return {
    dest: templateDest(templatePath, templateDir),
    content: render(source, context),
  };
}

/**
 * Scaffold the whole project into `targetDir`.
 *
 * @param {string} targetDir absolute path to the project root (workspace)
 * @param {object} context   render context from `buildContext()`
 * @param {object} [opts]    { templateDir? } for tests
 * @returns {Promise<{ ok: boolean, files: string[], errors: string[] }>}
 */
export async function scaffoldProject(targetDir, context, opts = {}) {
  const templateDir = opts.templateDir || TEMPLATE_DIR;
  const files = [];
  const errors = [];

  let templates;
  try {
    templates = await listTemplates(templateDir);
  } catch (err) {
    return {
      ok: false,
      files: [],
      errors: [`Cannot read templates from ${templateDir}: ${err?.message || err}`],
    };
  }

  for (const templatePath of templates) {
    try {
      const { dest, content } = await renderTemplate(templatePath, context, templateDir);
      const destPath = join(targetDir, dest);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content, "utf8");
      files.push(dest);
    } catch (err) {
      errors.push(`${templatePath}: ${err?.message || err}`);
    }
  }

  return { ok: errors.length === 0, files, errors };
}
