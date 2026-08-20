/**
 * Provider/model env resolution shared by every loop-launch path.
 *
 * The autonomous loop is launched detached via `nohup` from a bare bash `-c`
 * (see `startLoopDetached` and the `/loop` / `/loop-resume` extensions), so it
 * does NOT inherit the interactive session's `PI_PROVIDER`/`PI_MODEL` env vars.
 * Without them, a spawned persona `pi -p` falls back to pi's built-in default
 * provider (`google`), which is typically unauthenticated and can hang the
 * persona silently.
 *
 * This helper resolves the effective provider/model (project config ->
 * PI_* env -> pi user settings) and returns an env map to merge into the
 * detached loop process, so the loop *and* everything it spawns default to the
 * intended model.
 *
 * Plain JS on purpose — imported by both TS extensions (`harness.ts`,
 * `extensions/loop/index.ts`) and the JS seed CLI (`extensions/seed/core.js`),
 * and by the persona runner for consistency.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

/** Absolute path to pi's user settings file (`settings.json`). */
export const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

/**
 * Resolve the provider/model a loop/persona run should use.
 *
 * Priority (matching `/loop-doctor`'s `detectPiModel`):
 *  1. project config values (`config.pi.provider` / `config.pi.model`)
 *  2. `PI_PROVIDER` / `PI_MODEL` env vars (set by pi for every bash command)
 *  3. pi's user settings (`~/.pi/agent/settings.json` -> defaultProvider / defaultModel)
 *
 * @param {object} [opts]
 * @param {object} [opts.config] parsed project config (`{ pi: { provider, model } }`)
 * @param {object} [opts.env]    environment to read PI_* from (defaults to process.env)
 * @returns {{ provider: string, model: string }}
 */
export function resolveProviderModel(opts = {}) {
	const config = opts.config || {};
	const env = opts.env || process.env;

	let provider = String(config?.pi?.provider || "").trim();
	let model = String(config?.pi?.model || "").trim();

	if (!provider && env.PI_PROVIDER) provider = String(env.PI_PROVIDER).trim();
	if (!model && env.PI_MODEL) model = String(env.PI_MODEL).trim();

	// Fall back to pi's user settings (defaultProvider / defaultModel).
	if (!provider || !model) {
		try {
			if (existsSync(PI_SETTINGS_PATH)) {
				const settings = JSON.parse(readFileSync(PI_SETTINGS_PATH, "utf8"));
				provider = provider || String(settings.defaultProvider || "").trim();
				model = model || String(settings.defaultModel || "").trim();
			}
		} catch {
			// best-effort — env/config above are authoritative when present
		}
	}

	return { provider, model };
}

/**
 * Build an env map guaranteed to carry the resolved provider/model as
 * `PI_PROVIDER` / `PI_MODEL`, layered over the current environment (plus any
 * caller-supplied extra env). Use this when launching the detached loop or a
 * persona child so the spawned `pi` always picks the intended model.
 *
 * @param {object} [opts]
 * @param {object} [opts.config] parsed project config
 * @param {object} [opts.env]    extra env vars to merge over the current env
 * @param {object} [opts.base]   base env (defaults to process.env)
 * @returns {object} environment object suitable for `execa`/spawn `env`
 */
export function providerEnv(opts = {}) {
	const base = opts.base !== undefined ? opts.base : process.env;
	const env = { ...base, ...(opts.env || {}) };
	const { provider, model } = resolveProviderModel({ config: opts.config, env });
	if (provider) env.PI_PROVIDER = provider;
	if (model) env.PI_MODEL = model;
	return env;
}
