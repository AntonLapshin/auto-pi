/**
 * Project config copy for the auto-pi `/loop-seed` flow (M5).
 *
 * Copies `config/config.default.json` into `{project}/.pi/config.json`, filling
 * in the project-specific values (project name, repo, owner, ownerEmail, demo
 * URL, default branch), and generates the git-ignored local-secrets scaffold:
 *
 *   - `{project}/.pi/config.json`        committed project config (no secrets)
 *   - `{project}/.pi/local.example.json`  documented template for `.pi/local.json`
 *   - `{project}/.pi/config.schema.json`  JSON-Schema reference (relative `$schema`)
 *
 * Plain JS on purpose — imported by `extensions/seed/core.js` (via jiti) and
 * directly by tests.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Absolute path to the harness `config/config.default.json`. */
export const DEFAULT_CONFIG_FILE = new URL(
	"../../config/config.default.json",
	import.meta.url,
).pathname;

/** Absolute path to the harness `config/config.schema.json`. */
export const SCHEMA_FILE = new URL(
	"../../config/config.schema.json",
	import.meta.url,
).pathname;

/**
 * Load the default project config (config/config.default.json).
 * @returns {Promise<object>} parsed default config
 */
export async function loadDefaultConfig(configFile = DEFAULT_CONFIG_FILE) {
	const raw = await readFile(configFile, "utf8");
	return JSON.parse(raw);
}

/**
 * Build the project-specific config for `{project}/.pi/config.json`.
 *
 * Starts from the default config and fills in the `project` section with the
 * values resolved at seed time. Every other section is carried over unchanged
 * (no secrets live in the default config).
 *
 * @param {object} opts
 * @param {object} opts.defaults      parsed default config (from loadDefaultConfig)
 * @param {string} opts.projectName   human-friendly project name
 * @param {string} opts.repo          repo (slug) name
 * @param {string} opts.owner         GitHub owner
 * @param {string} [opts.ownerEmail]  owner email (may be empty)
 * @param {string} [opts.demoUrl]     GitHub Pages demo URL
 * @param {string} [opts.defaultBranch] default branch (defaults to config value)
 * @returns {object} project config with `project` section filled
 */
export function buildProjectConfig({
	defaults,
	projectName,
	repo,
	owner,
	ownerEmail = "",
	demoUrl,
	defaultBranch,
}) {
	const cfg = JSON.parse(JSON.stringify(defaults ?? {}));
	cfg.project = {
		...(cfg.project || {}),
		name: projectName,
		repo,
		owner,
		ownerEmail: ownerEmail || cfg.project?.ownerEmail || "",
		defaultBranch: defaultBranch || cfg.project?.defaultBranch || "main",
		demoUrl: demoUrl || cfg.project?.demoUrl || "",
	};
	return cfg;
}

/**
 * The documented template for the git-ignored `{project}/.pi/local.json`.
 *
 * plan.md §7.2: local secrets (API keys, tokens, chat IDs) live in
 * `.pi/local.json` which is git-ignored. Values are read from environment
 * variables at runtime so they never touch versioned files. This example file
 * documents the Telegram env-var pattern (M11) and any other local knobs.
 */
export function localExample() {
	return {
		$comment:
			"auto-pi local secrets & overrides. Copy this file to .pi/local.json — it is git-ignored and never committed. Values are read from environment variables at runtime; do not hardcode secrets here.",
		notifications: {
			telegram: {
				// plan.md §7.2 / M11: Telegram notifications are opt-in and
				// env-driven. Set these env vars (or edit local.json) to enable.
				enabled: false,
				botTokenEnv: "TELEGRAM_BOT_TOKEN",
				chatIdEnv: "TELEGRAM_CHAT_ID",
				notifyOnDone: true,
				notifyOnStopped: true,
				notifyOnNeedsHuman: true,
			},
		},
		// Example of how a secret is resolved from the environment:
		// "github": { "tokenEnv": "GH_TOKEN" },
	};
}

/**
 * Generate the `.pi/` config + local-secrets scaffold into a project workspace.
 *
 * Writes:
 *   - `{workspace}/.pi/config.json`        committed project config
 *   - `{workspace}/.pi/local.example.json` documented local-secrets template
 *   - `{workspace}/.pi/config.schema.json` JSON-Schema reference ($schema
 *     pointing at the harness schema via a relative `$ref`)
 *
 * @param {string} workspace absolute path to the project root
 * @param {object} values    { projectName, repo, owner, ownerEmail?, demoUrl?, defaultBranch? }
 * @param {object} [opts]    { configFile?, schemaFile? } for tests
 * @returns {Promise<{ ok: boolean, files: string[], errors: string[] }>}
 */
export async function writeProjectConfig(workspace, values, opts = {}) {
	const files = [];
	const errors = [];
	const piDir = join(workspace, ".pi");

	try {
		const defaults = await loadDefaultConfig(opts.configFile);
		const cfg = buildProjectConfig({ defaults, ...values });

		await mkdir(piDir, { recursive: true });
		await writeFile(join(piDir, "config.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
		files.push(".pi/config.json");

		await writeFile(
			join(piDir, "local.example.json"),
			JSON.stringify(localExample(), null, 2) + "\n",
			"utf8",
		);
		files.push(".pi/local.example.json");

		// Relative `$schema` reference so tooling in the generated project can
		// validate `.pi/config.json` against the harness schema. The schema is
		// committed here as a convenience reference (it contains no secrets).
		const schemaRef = {
			$schema: "http://json-schema.org/draft-07/schema#",
			$ref: "https://auto-pi.dev/schemas/config.schema.json",
			$comment:
				"auto-pi config schema reference. Validate .pi/config.json against the harness schema (config/config.schema.json in the auto-pi repo).",
		};
		await writeFile(
			join(piDir, "config.schema.json"),
			JSON.stringify(schemaRef, null, 2) + "\n",
			"utf8",
		);
		files.push(".pi/config.schema.json");

		return { ok: errors.length === 0, files, errors };
	} catch (err) {
		return {
			ok: false,
			files,
			errors: [`Cannot write project config into ${piDir}: ${err?.message || err}`],
		};
	}
}
