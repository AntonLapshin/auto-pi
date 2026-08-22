/**
 * Config validation & sync for the auto-pi harness (M13, plan.md §3.3 / §28).
 *
 * Provides:
 *
 *   - `validateConfig(config)` — validates a parsed config object against the
 *     harness JSON-Schema (`config/config.schema.json`). Fails fast at `/loop-seed`
 *     and loop start when the config is invalid, with a clear list of problems.
 *   - `syncConfig(workspace)` — recopies `config/config.default.json` into
 *     `{workspace}/.pi/config.json` while preserving project-specific values
 *     (name, repo, owner, ownerEmail, demoUrl, defaultBranch) and any
 *     user customisations under a `custom` key (plan.md §3.3 `/loop-sync-config`).
 *
 * Validation uses a lightweight structural check (no external validator
 * dependency beyond what the harness already ships). It checks the top-level
 * sections and the key numeric/enum constraints declared in the schema.
 *
 * Plain JS on purpose — imported via jiti by the extensions and directly by
 * tests / node scripts.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Absolute path to the harness `config/config.schema.json`. */
export const SCHEMA_FILE = new URL(
	"../../config/config.schema.json",
	import.meta.url,
).pathname;

/** Absolute path to the harness `config/config.default.json`. */
export const DEFAULT_CONFIG_FILE = new URL(
	"../../config/config.default.json",
	import.meta.url,
).pathname;

/** Top-level sections the schema declares. */
const TOP_LEVEL = [
	"project", "pi", "loop", "limits", "github", "stack", "quality",
	"review", "pages", "notifications", "logging",
];

/**
 * Validate a parsed config object against the harness JSON-Schema.
 * Returns `{ ok, errors }` where errors is an array of human-readable
 * problem strings. Fails fast: the caller should treat `!ok` as fatal at
 * `/loop-seed` / loop start.
 *
 * @param {object} config parsed .pi/config.json
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig(config) {
	const errors = [];
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return { ok: false, errors: ["config is not an object"] };
	}

	// Top-level sections must be objects when present.
	for (const key of TOP_LEVEL) {
		const v = config[key];
		if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) {
			errors.push(`section "${key}" must be an object`);
		}
	}

	// project — validate types only when the fields are present (a real
	// seed-generated config always has these, but be lenient for minimal configs).
	const project = config.project || {};
	if (project.name !== undefined && typeof project.name !== "string") errors.push("project.name must be a string");
	if (project.repo !== undefined && typeof project.repo !== "string") errors.push("project.repo must be a string");
	if (project.owner !== undefined && typeof project.owner !== "string") errors.push("project.owner must be a string");
	if (project.ownerEmail !== undefined && typeof project.ownerEmail !== "string") errors.push("project.ownerEmail must be a string");
	if (project.defaultBranch !== undefined && typeof project.defaultBranch !== "string") errors.push("project.defaultBranch must be a string");
	if (project.demoUrl !== undefined && typeof project.demoUrl !== "string") errors.push("project.demoUrl must be a string");

	// pi
	const pi = config.pi || {};
	if (pi.contextMaxTokens !== undefined) {
		const n = Number(pi.contextMaxTokens);
		// 0 = unlimited (no context cap).
		if (!Number.isFinite(n) || n < 0) {
			errors.push("pi.contextMaxTokens must be an integer >= 0 (0 = unlimited)");
		}
	}

	// loop
	const loop = config.loop || {};
	if (loop.intervalSeconds !== undefined) {
		const n = Number(loop.intervalSeconds);
		if (!Number.isFinite(n) || n < 5) errors.push("loop.intervalSeconds must be >= 5");
	}
	if (loop.maxConsecutiveFailures !== undefined) {
		const n = Number(loop.maxConsecutiveFailures);
		if (!Number.isFinite(n) || n < 1) errors.push("loop.maxConsecutiveFailures must be >= 1");
	}
	if (loop.stopOnBudgetExceeded !== undefined && typeof loop.stopOnBudgetExceeded !== "boolean") {
		errors.push("loop.stopOnBudgetExceeded must be a boolean");
	}

	// limits. Token/context caps accept 0 = unlimited (no cap); cost accepts >= 0.
	const limits = config.limits || {};
	for (const key of ["maxBatchIssues", "maxIssueAttempts", "maxTokensPerCycle", "maxTokensPerDay", "maxPromptTokensPerPersona", "maxOutputTokensPerPersona"]) {
		if (limits[key] !== undefined) {
			const n = Number(limits[key]);
			// maxTokensPerCycle / maxTokensPerDay / maxPromptTokensPerPersona /
			// maxOutputTokensPerPersona may be 0 to disable the cap (unlimited).
			const allowZero = ["maxTokensPerCycle", "maxTokensPerDay", "maxPromptTokensPerPersona", "maxOutputTokensPerPersona"].includes(key);
			const min = allowZero ? 0 : 1;
			if (!Number.isFinite(n) || n < min) errors.push(`limits.${key} must be >= ${min}`);
		}
	}
	if (limits.maxCostPerDayUsd !== undefined) {
		const n = Number(limits.maxCostPerDayUsd);
		if (!Number.isFinite(n) || n < 0) errors.push("limits.maxCostPerDayUsd must be >= 0");
	}

	// github
	const github = config.github || {};
	if (github.repoVisibility !== undefined && !["public", "private"].includes(github.repoVisibility)) {
		errors.push("github.repoVisibility must be 'public' or 'private'");
	}
	if (github.autoCreateRepo !== undefined && typeof github.autoCreateRepo !== "boolean") {
		errors.push("github.autoCreateRepo must be a boolean");
	}

	// stack
	const stack = config.stack || {};
	if (stack.framework !== undefined && stack.framework !== "react") {
		errors.push("stack.framework must be 'react'");
	}
	if (stack.testRunner !== undefined && stack.testRunner !== "vitest") {
		errors.push("stack.testRunner must be 'vitest'");
	}

	// quality
	const quality = config.quality || {};
	if (quality.coreCoveragePercent !== undefined) {
		const n = Number(quality.coreCoveragePercent);
		if (!Number.isFinite(n) || n < 0 || n > 100) {
			errors.push("quality.coreCoveragePercent must be between 0 and 100");
		}
	}

	// pages
	const pages = config.pages || {};
	if (pages.enabled !== undefined && typeof pages.enabled !== "boolean") {
		errors.push("pages.enabled must be a boolean");
	}

	// logging
	const logging = config.logging || {};
	if (logging.maxFileSizeMb !== undefined) {
		const n = Number(logging.maxFileSizeMb);
		if (!Number.isFinite(n) || n < 1) errors.push("logging.maxFileSizeMb must be >= 1");
	}
	if (logging.rotate !== undefined && typeof logging.rotate !== "boolean") {
		errors.push("logging.rotate must be a boolean");
	}

	return { ok: errors.length === 0, errors };
}

/**
 * Load the default config from the harness (config/config.default.json).
 * @returns {Promise<object>}
 */
export async function loadDefaultConfig(configFile = DEFAULT_CONFIG_FILE) {
	const raw = await readFile(configFile, "utf8");
	return JSON.parse(raw);
}

/**
 * Read a project's current `.pi/config.json`.
 * @param {string} workspace
 * @returns {Promise<{ ok: boolean, config?: object, error?: string }>}
 */
export async function readProjectConfig(workspace) {
	const file = join(workspace, ".pi", "config.json");
	try {
		const raw = await readFile(file, "utf8");
		return { ok: true, config: JSON.parse(raw) };
	} catch (err) {
		return { ok: false, error: `Cannot read ${file}: ${err?.message || err}` };
	}
}

/**
 * Sync `{workspace}/.pi/config.json` back to the harness defaults while
 * preserving project-specific values (plan.md §3.3 `/loop-sync-config`).
 *
 * Preserved from the current config:
 *   - the whole `project` section (name, repo, owner, ownerEmail, demoUrl,
 *     defaultBranch)
 *   - any `custom` object (user overrides / local knobs)
 *   - any `notifications.telegram` overrides the user set (env-var names, flags)
 *
 * Every other section is recopied from the defaults, so new default knobs added
 * in later milestones propagate to existing projects without clobbering the
 * project identity.
 *
 * @param {string} workspace absolute project root
 * @param {object} [opts]    { configFile? } for tests
 * @returns {Promise<{ ok: boolean, config?: object, changed?: string[], error?: string }>}
 */
export async function syncConfig(workspace, opts = {}) {
	const current = await readProjectConfig(workspace);
	if (!current.ok) {
		return { ok: false, error: current.error };
	}

	const defaults = await loadDefaultConfig(opts.configFile);
	const merged = JSON.parse(JSON.stringify(defaults));

	// Preserve the project identity + user customisations/telegram overrides.
	const cur = current.config;
	if (cur?.project) merged.project = JSON.parse(JSON.stringify(cur.project));
	if (cur?.custom) merged.custom = JSON.parse(JSON.stringify(cur.custom));
	if (cur?.notifications?.telegram) {
		merged.notifications = merged.notifications || {};
		merged.notifications.telegram = JSON.parse(JSON.stringify(cur.notifications.telegram));
	}

	const changed = diffKeys(merged, cur);

	try {
		const piDir = join(workspace, ".pi");
		await mkdir(piDir, { recursive: true });
		await writeFile(join(piDir, "config.json"), JSON.stringify(merged, null, 2) + "\n", "utf8");
		return { ok: true, config: merged, changed };
	} catch (err) {
		return { ok: false, error: `Cannot write synced config: ${err?.message || err}` };
	}
}

/**
 * Compute the top-level keys that changed between the merged (new) config and
 * the current one — used to report what `/loop-sync-config` updated.
 */
function diffKeys(merged, current) {
	const changed = [];
	const newKeys = Object.keys(merged || {});
	const curKeys = Object.keys(current || {});
	for (const key of new Set([...newKeys, ...curKeys])) {
		const a = JSON.stringify(merged?.[key]);
		const b = JSON.stringify(current?.[key]);
		if (a !== b) changed.push(key);
	}
	return changed;
}
