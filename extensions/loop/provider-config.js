/**
 * Provider/model config read + update for the auto-pi loop.
 *
 * The loop resolves the provider/model a persona session uses from the active
 * project's `.pi/config.json` (`config.pi.provider` / `config.pi.model`), falling
 * back to `PI_PROVIDER`/`PI_MODEL` env and pi's user settings (see
 * `provider-env.js`). This module reads the *effective* provider/model the loop
 * is using and persists a new provider/model back into the project config so a
 * `/loop-provider` switch survives restarts and applies to every future persona
 * run.
 *
 * Plain JS on purpose — shared by the `/loop-provider` extension command and by
 * tests / fallback CLIs.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Absolute path to the project's `.pi/config.json`. */
export function projectConfigPath(workspace) {
	return join(workspace, ".pi", "config.json");
}

/**
 * Read the provider/model currently *configured* in the project config
 * (`config.pi.provider` / `config.pi.model`). These are the values the loop
 * pins for persona runs.
 *
 * @param {string} workspace absolute project root
 * @returns {Promise<{ ok: boolean, provider: string, model: string, config?: object, error?: string }>}
 */
export async function readConfiguredProviderModel(workspace) {
	const file = projectConfigPath(workspace);
	try {
		const raw = await readFile(file, "utf8");
		const config = JSON.parse(raw);
		return {
			ok: true,
			provider: String(config?.pi?.provider || "").trim(),
			model: String(config?.pi?.model || "").trim(),
			config,
		};
	} catch (err) {
		return {
			ok: false,
			provider: "",
			model: "",
			error: `Cannot read ${file}: ${err?.message || err}`,
		};
	}
}

/**
 * Persist a new provider/model into the project's `.pi/config.json`, preserving
 * every other section unchanged.
 *
 * @param {string} workspace absolute project root
 * @param {{ provider: string, model: string }} update
 * @returns {Promise<{ ok: boolean, config?: object, changed?: string[], error?: string }>}
 */
export async function writeProviderModel(workspace, update) {
	const file = projectConfigPath(workspace);
	const current = await readConfiguredProviderModel(workspace);
	if (!current.ok) return { ok: false, error: current.error };

	const config = current.config;
	const provider = String(update?.provider || "").trim();
	const model = String(update?.model || "").trim();

	if (!config.pi) config.pi = {};
	const changed = [];
	if (provider && provider !== current.provider) {
		config.pi.provider = provider;
		changed.push("provider");
	}
	if (model && model !== current.model) {
		config.pi.model = model;
		changed.push("model");
	}

	// Nothing to change — report success with no changes.
	if (changed.length === 0) {
		return { ok: true, config, changed: [], error: undefined };
	}

	try {
		await writeFile(file, JSON.stringify(config, null, 2) + "\n", "utf8");
		return { ok: true, config, changed, error: undefined };
	} catch (err) {
		return { ok: false, error: `Cannot write ${file}: ${err?.message || err}` };
	}
}
