/**
 * Shared core logic for the auto-pi `/doctor` environment prerequisite checks (M1).
 *
 * This module is plain JavaScript on purpose so it can be imported both by
 * `scripts/doctor.js` (the fallback Node CLI, run under `node scripts/doctor.js`)
 * and by `extensions/doctor/index.ts` (the `/doctor` slash command, loaded by pi
 * through jiti). Keeping the checks here means the CLI and the interactive command
 * always report the same results.
 *
 * Each check returns a result object:
 *   {
 *     id:        stable machine-readable id
 *     name:      human-readable check name
 *     ok:        boolean pass/fail
 *     detail:    short detail shown next to the ✅/❌ (e.g. version, account)
 *     hint:      actionable remediation hint shown when the check fails
 *     required:  whether a failure should count against the overall exit status
 *     bestEffort: informational only (never fails the run)
 *   }
 */

import { homedir, tmpdir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";
import { access, constants } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execa } from "execa";

/** Minimum Node.js major version required by the harness (package.json engines). */
export const MIN_NODE_MAJOR = 18;

/** GitHub scopes the harness requires (docs/github-token.md). */
export const REQUIRED_SCOPES = ["repo", "workflow"];

/** Workspace directory the harness uses for per-machine state (one project). */
export const WORKSPACE_DIR = join(homedir(), ".auto-pi");

/**
 * Safely run a command, returning { ok, stdout, stderr, exitCode } without throwing.
 * Used for read-only prerequisite probes.
 */
async function probe(command, args, opts = {}) {
	try {
		const res = await execa(command, args, {
			reject: false,
			timeout: 15000,
			...opts,
		});
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch {
		return { ok: false, stdout: "", stderr: "", exitCode: 1 };
	}
}

/** Check a binary is on PATH and print its --version. */
async function checkTool(id, name, versionArgs, extraHint) {
	const probe1 = await probe(versionArgs[0], versionArgs.slice(1));
	if (!probe1.ok) {
		return {
			id,
			name,
			ok: false,
			detail: "not found",
			hint: `${extraHint}${extraHint ? " " : ""}(needs to be installed and on PATH)`,
			required: true,
			bestEffort: false,
		};
	}
	const version = (probe1.stdout || probe1.stderr || "").split("\n")[0]?.trim() || "present";
	return { id, name, ok: true, detail: version, hint: "", required: true, bestEffort: false };
}

/** Parse the token scopes listed by `gh auth status`. */
function parseScopes(stdout) {
	const line = stdout.split("\n").find((l) => /token scopes/i.test(l));
	if (!line) return [];
	// "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'"
	const after = line.split("scopes")[1] ?? "";
	const matches = after.match(/'([^']+)'/g) ?? [];
	return matches.map((m) => m.replace(/'/g, "").trim()).filter(Boolean);
}

/**
 * Detect the active Pi provider/model.
 * Priority: explicit overrides (passed by the `/doctor` extension from ctx.model),
 * then PI_PROVIDER/PI_MODEL env vars (set by pi for every bash command), then pi's
 * settings.json defaults.
 */
async function detectPiModel(overrides = {}) {
	let provider = overrides.provider;
	let model = overrides.model;

	if (!provider && process.env.PI_PROVIDER) provider = process.env.PI_PROVIDER;
	if (!model && process.env.PI_MODEL) model = process.env.PI_MODEL;

	// Fall back to pi's user settings (defaultProvider / defaultModel).
	if (!provider || !model) {
		try {
			const settingsPath = join(
				homedir(),
				".pi",
				"agent",
				"settings.json",
			);
			if (existsSync(settingsPath)) {
				const settings = JSON.parse(await readFile(settingsPath, "utf8"));
				provider = provider || settings.defaultProvider;
				model = model || settings.defaultModel;
			}
		} catch {
			// ignore — env vars above are the authoritative source when present
		}
	}

	return { provider: provider || "", model: model || "" };
}

/** Best-effort glimpse at GitHub Pages readiness (informational, never fails). */
async function checkPages(ghTokenOk) {
	// We don't want to hit the network here. Report the requirement and whether
	// the prerequisite auth is present; Pages itself is provisioned at seed time.
	if (!ghTokenOk) {
		return {
			id: "pages",
			name: "GitHub Pages",
			ok: false,
			detail: "ungated — depends on gh auth + repo",
			hint: "Pages is configured at seed time; ensure gh is authenticated with repo & workflow scopes.",
			required: false,
			bestEffort: true,
		};
	}
	return {
		id: "pages",
		name: "GitHub Pages",
		ok: true,
		detail: "auth present; Pages will be enabled at seed time",
		hint: "",
		required: false,
		bestEffort: true,
	};
}

/**
 * Run all environment prerequisite checks.
 *
 * @param {object} [opts]
 * @param {object} [opts.overrides]        Explicit pi provider/model from `/doctor`.
 * @param {string} [opts.workspaceDir]     Override the workspace directory (tests).
 * @returns {Promise<Array<object>>}       Array of check result objects.
 */
export async function runChecks(opts = {}) {
	const overrides = opts.overrides || {};
	const results = [];

	// 1. Node.js version
	{
		const r = await checkTool("node", "Node.js", ["node", "--version"], "Install Node.js >= 18 (e.g. via nvm)");
		if (r.ok) {
			const v = r.detail.replace(/^v/i, "");
			const maj = parseInt(v.split(".")[0], 10);
			const meets = !Number.isNaN(maj) && maj >= MIN_NODE_MAJOR;
			r.ok = meets;
			r.detail = meets ? r.detail : `${r.detail} (needs >= ${MIN_NODE_MAJOR})`;
			r.hint = meets ? "" : `Node.js >= ${MIN_NODE_MAJOR} required; upgrade your Node installation.`;
		}
		results.push(r);
	}

	// 2. npm
	results.push(await checkTool("npm", "npm", ["npm", "--version"], "Install npm (ships with Node.js)"));

	// 3. git
	results.push(await checkTool("git", "git", ["git", "--version"], "Install git (e.g. sudo apt install git)"));

	// 4. GitHub CLI gh
	results.push(await checkTool("gh", "GitHub CLI (gh)", ["gh", "--version"], "Install GitHub CLI (see https://cli.github.com)"));

	// 5 & 6. gh authentication + token scopes
	{
		const ghAuth = await probe("gh", ["auth", "status"]);
		let authCheck = {
			id: "gh-auth",
			name: "gh authenticated",
			ok: ghAuth.ok,
			detail: "",
			hint: ghAuth.ok ? "" : "Run `gh auth login` and follow the prompts, then `gh auth status` to verify.",
			required: true,
			bestEffort: false,
		};
		if (ghAuth.ok) {
			const loginMatch = ghAuth.stdout.match(/Logged in to \S+ account (\S+)/);
			authCheck.detail = loginMatch ? loginMatch[1] : "authenticated";
		}
		results.push(authCheck);

		const scopes = ghAuth.ok ? parseScopes(ghAuth.stdout) : [];
		const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
		const scopeOk = missing.length === 0;
		results.push({
			id: "gh-scopes",
			name: "gh token scopes (repo, workflow)",
			ok: scopeOk,
			detail: ghAuth.ok
				? scopeOk
					? scopes.join(", ")
					: `missing: ${missing.join(", ")}`
				: "n/a (not authenticated)",
			hint: ghAuth.ok
				? scopeOk
					? ""
					: "Your token lacks required scopes. Run `gh auth refresh -s repo -s workflow` (or `gh auth login`) to add the `repo` and `workflow` scopes."
				: "Authenticate first with `gh auth login`, then re-run /doctor.",
			required: true,
			bestEffort: false,
		});

		results.push(await checkPages(authCheck.ok && scopeOk));
	}

	// 7. Pi CLI present and runnable
	{
		const pi = await probe("pi", ["--version"]);
		results.push({
			id: "pi",
			name: "Pi CLI",
			ok: pi.ok,
			detail: pi.ok ? (pi.stdout || pi.stderr || "").split("\n")[0]?.trim() || "runnable" : "not found",
			hint: pi.ok
				? ""
				: "Pi (@earendil-works/pi-coding-agent) is not on PATH. Install it globally (e.g. npm i -g @earendil-works/pi-coding-agent) or reinstall the harness with `pi install`.",
			required: true,
			bestEffort: false,
		});
	}

	// 8. Pi model/provider configured
	{
		const { provider, model } = await detectPiModel(overrides);
		const configured = Boolean(provider && model);
		results.push({
			id: "pi-model",
			name: "Pi model/provider configured",
			ok: configured,
			detail: configured ? `${provider}/${model}` : "none detected",
			hint: configured
				? ""
				: "No Pi model is selected. Start pi and pick a provider/model (e.g. the bundled joingonka/gonkaapi) with `/model`, or set it in your pi settings. Ensure the matching API key env var is exported.",
			required: true,
			bestEffort: false,
		});
	}

	// 9. Workspace directory ~/.auto-pi exists and is writable
	{
		const dir = opts.workspaceDir || WORKSPACE_DIR;
		let ok = true;
		let detail = dir;
		if (!existsSync(dir)) {
			ok = false;
			detail = "missing";
		} else {
			try {
				await access(dir, constants.W_OK | constants.R_OK);
			} catch {
				ok = false;
				detail = "not writable";
			}
		}
		// tmpdir must be usable to ever create the workspace.
		const tmpUsable = existsSync(tmpdir());
		if (!tmpUsable) {
			ok = false;
			detail = `${detail} (no usable temp dir)`;
		}
		results.push({
			id: "workspace",
			name: "Workspace ~/.auto-pi",
			ok,
			detail,
			hint: ok
				? ""
				: `Create the workspace with: mkdir -p ${dir}\nThen ensure it is writable by your user.`,
			required: true,
			bestEffort: false,
		});
	}

	return results;
}

/** True when every required (non-best-effort) check passed. */
export function allPassed(results) {
	return results.every((r) => r.bestEffort || r.ok);
}

/** Render the full ✅/❌ report and the summary line into a single string. */
export function formatReport(results) {
	const lines = results.map((r) => {
		const icon = r.ok ? "✅" : "❌";
		const marker = r.bestEffort ? " (best-effort)" : "";
		const line = `${icon} ${r.name}${marker} — ${r.detail}`;
		if (!r.ok && r.hint) return `${line}\n     ↳ ${r.hint}`;
		return line;
	});

	const passed = results.filter((r) => r.bestEffort || r.ok).length;
	const failed = results.length - passed;

	const summary =
		failed === 0
			? `\nAll ${results.length} checks passed. Ready to /seed.`
			: `\n${failed} of ${results.length} checks FAILED. Fix the items above, then re-run /doctor.`;

	return lines.join("\n") + "\n" + summary;
}
