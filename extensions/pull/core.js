/**
 * Shared core for the auto-pi `/loop-pull` flow.
 *
 * Pulls an existing auto-pi project from a GitHub repo onto this machine so it
 * can be continued here exactly as if it had been seeded locally. This is the
 * "continue on a different machine" companion to `/loop-seed`:
 *
 *   - On machine A you `/loop-seed` a project. The repo on GitHub contains the
 *     project code plus the committed `.pi/config.json` (the git-ignored local
 *     state — `.pi/state/`, `.pi/logs/`, `.pi/runs/`, `.pi/local.json` — is NOT
 *     in the repo).
 *   - On machine B you `pi install /path/to/auto-pi` then `/loop-pull <repo-url>`.
 *     It clones the repo into the same `~/.auto-pi/workspaces/{owner}/{repo}/repo`
 *     layout `/loop-seed` uses, verifies it is an auto-pi project, recreates the
 *     git-ignored `.pi/state/initiation.json` marker (so `/loop-switch` and the
 *     loop-recognition helpers see it as a locally-seeded project), records it as
 *     the active project, and (optionally) starts the loop.
 *
 * After `/loop-pull`, every other auto-pi command works exactly as if the project
 * had been seeded on this machine: `/loop-switch`, `/loop-status`, `/loop-logs`,
 * `/loop-restart`, `/loop`, etc.
 *
 * UI is injected by the caller so the same flow drives both the interactive
 * `/loop-pull` command and the `npm run pull` fallback CLI:
 *
 *   {
 *     notify: (text, level?) => void,
 *     confirmPull: async (repo) => boolean,   // optional, defaults to true
 *   }
 *
 * Plain JS on purpose — imported by `extensions/pull/index.ts` (via jiti) and
 * `scripts/pull.js` (via node), matching the seed/doctor convention.
 */

import { join, basename } from "node:path";
import { readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execa } from "execa";
import {
	AUTO_PI_DIR,
	CURRENT_PROJECT_FILE,
	WORKSPACES_DIR,
	DEFAULT_BRANCH,
	INITIATION_STATE_VERSION,
	PROJECT_STATUS,
} from "../seed/constants.js";
import {
	readActiveProject,
	writeActiveProjectRecord,
	writeStopFile,
	checkLock,
	waitForLoopExit,
	startLoopDetached,
} from "../loop/orchestrator.js";
import { validateConfig } from "../../skills/config/core.js";

/**
 * Parse a GitHub repo reference (URL or `owner/repo`) into { owner, repo }.
 *
 * Accepts the common forms:
 *   - https://github.com/owner/repo[/...]
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 *   - ssh://git@github.com/owner/repo.git
 *   - owner/repo  /  owner/repo.git
 *
 * @param {string} ref
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseRepoRef(ref) {
	const input = String(ref || "").trim();
	if (!input) return null;

	let path = input;

	// ssh://git@github.com/owner/repo.git
	const sshProto = /^ssh:\/\/[^/]+@([^/:]+)[:/](.+)$/i.exec(input);
	// git@github.com:owner/repo.git
	const scpLike = /^[^@]+@([^:]+):(.+)$/.exec(input);
	// https?://github.com/owner/repo
	const https = /^https?:\/\/github\.com\/(.+)$/i.exec(input);

	if (https) {
		path = https[1];
	} else if (sshProto) {
		path = sshProto[2];
	} else if (scpLike) {
		path = scpLike[2];
	}

	// Strip a trailing .git and any leading/trailing slashes.
	path = path.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");

	// Split owner/repo (ignore any extra path segments after the repo).
	const parts = path.split("/").filter(Boolean);
	if (parts.length < 2) return null;
	const owner = parts[0];
	const repo = parts[1];
	if (!owner || !repo) return null;

	return { owner, repo };
}

/** Run a `gh` command safely. @returns {{ ok, stdout, stderr, exitCode }} */
async function gh(args, opts = {}) {
	try {
		const res = await execa("gh", args, { reject: false, timeout: 30000, ...opts });
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err?.message || err), exitCode: 1 };
	}
}

/**
 * Verify the repo exists on GitHub (via `gh`) and resolve its visibility.
 * @returns {Promise<{ exists: boolean, visibility?: string, error?: string }>}
 */
export async function repoInfo(owner, repo) {
	const res = await gh(["repo", "view", `${owner}/${repo}`, "--json", "visibility,isPrivate", "-q", ".visibility"]);
	if (!res.ok) {
		return { exists: false, error: res.stderr?.trim() || res.stdout?.trim() || res.exitCode };
	}
	return { exists: true, visibility: res.stdout.trim() || "" };
}

/**
 * Map an owner/repo pair to the same deterministic local workspace path the
 * seed flow uses: `~/.auto-pi/workspaces/{owner}/{repo}/repo`. Using the exact
 * same layout means `/loop-switch` and the loop-recognition helpers see the
 * pulled project as a normal locally-seeded project.
 */
export function workspaceFor(owner, repo, workspacesDir = WORKSPACES_DIR) {
	return join(workspacesDir, owner, repo, "repo");
}

/**
 * Clone the repo into the workspace path (same convention as seed's cloneRepo).
 * Falls back to init + remote add when a plain clone fails.
 * @param {string} workspace
 * @param {string} owner
 * @param {string} repo
 * @param {object} [opts] { url? } override the clone URL (tests)
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function cloneProject(workspace, owner, repo, opts = {}) {
	const parent = join(workspace, ".."); // .../{owner}/{repo}
	const destDir = basename(workspace); // "repo"
	const url = opts.url || `https://github.com/${owner}/${repo}.git`;
	try {
		await mkdir(parent, { recursive: true });
		const res = await execa("git", ["clone", url, destDir], {
			cwd: parent,
			reject: false,
			timeout: 120000,
		});
		if (res.exitCode === 0) {
			return { ok: true, message: `Cloned https://github.com/${owner}/${repo}.git` };
		}
		// Fallback: init an empty repo locally and point it at the remote.
		await rm(workspace, { recursive: true, force: true }).catch(() => {});
		await mkdir(workspace, { recursive: true });
		await execa("git", ["init", "-b", DEFAULT_BRANCH], { cwd: workspace, reject: false });
		await execa("git", ["remote", "add", "origin", url], { cwd: workspace, reject: false });
		return {
			ok: true,
			message: `Clone failed (${res.stderr?.trim() || res.exitCode}); initialized locally with origin -> ${url}`,
		};
	} catch (err) {
		return { ok: false, message: `Could not clone ${url}: ${err?.message || err}` };
	}
}

/**
 * Read the committed project config `{workspace}/.pi/config.json`.
 * @returns {Promise<{ ok: boolean, config?: object, error?: string }>}
 */
export async function readProjectConfig(workspace) {
	const file = join(workspace, ".pi", "config.json");
	try {
		const raw = await readFile(file, "utf8");
		return { ok: true, config: JSON.parse(raw) };
	} catch (err) {
		return { ok: false, error: `Missing or invalid ${file}: ${err?.message || err}` };
	}
}

/**
 * Recreate the git-ignored `.pi/state/initiation.json` marker for a pulled
 * project.
 *
 * The initiation state is written by `/loop-seed` but is git-ignored (it is
 * per-machine local state), so it is NOT present in the cloned repo. The
 * loop-recognition helpers (`listProjects` / `resolveProject` in
 * `extensions/loop/orchestrator.js`) require this file to treat a workspace as
 * a locally-seeded project, so `/loop-pull` must regenerate it from the
 * committed `.pi/config.json` (which holds the project name, owner, repo).
 *
 * If an initiation.json already exists (e.g. the workspace was pulled before),
 * it is preserved.
 *
 * @param {string} workspace
 * @param {object} config the parsed `.pi/config.json`
 * @returns {Promise<{ ok: boolean, created: boolean, message: string }>}
 */
export async function ensureInitiationState(workspace, config) {
	const stateDir = join(workspace, ".pi", "state");
	const file = join(stateDir, "initiation.json");
	try {
		// Already present → nothing to do.
		await access(file, fsConstants.R_OK);
		return { ok: true, created: false, message: "initiation.json already present." };
	} catch {
		// Absent → recreate it.
	}
	const project = config?.project || {};
	const owner = project.owner || "";
	const repo = project.repo || "";
	const now = new Date().toISOString();
	const payload = {
		version: INITIATION_STATE_VERSION,
		projectName: project.name || repo || "",
		description: "",
		repo: {
			owner,
			name: repo,
			fullName: [owner, repo].filter(Boolean).join("/"),
			alternativesConsidered: [],
			existed: true,
		},
		workspace,
		clarification: {},
		manifest: { source: "pulled" },
		createdAt: now,
		updatedAt: now,
		status: "initiated",
	};
	try {
		await mkdir(stateDir, { recursive: true });
		await writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
		return { ok: true, created: true, message: `Wrote ${file}` };
	} catch (err) {
		return { ok: false, created: false, message: `Could not write ${file}: ${err?.message || err}` };
	}
}

/**
 * Main `/loop-pull` orchestration.
 *
 * @param {string} ref the repo URL / owner:repo reference
 * @param {object} io  injected UI handlers: { notify, confirmPull? }
 * @param {object} [opts] { workspacesDir?, currentProjectFile?, startLoop?,
 *                          confirmPull?, owner?, repoInfo? } for tests/overrides
 *                          (repoInfo is injectable for hermetic tests; defaults
 *                          to the `gh`-based check).
 * @returns {Promise<{ ok: boolean, message: string, workspace?: string, repo?: string }>}
 */
export async function runPull(ref, io = {}, opts = {}) {
	const notify = io.notify || ((t) => process.stdout.write(t + "\n"));
	const workspacesDir = opts.workspacesDir || WORKSPACES_DIR;
	const currentProjectFile = opts.currentProjectFile || CURRENT_PROJECT_FILE;
	const repoCheck = opts.repoInfo || repoInfo;

	// 0. Parse the repo reference.
	const parsed = opts.owner
		? { owner: opts.owner, repo: parseRepoRef(ref)?.repo || String(ref || "").trim() }
		: parseRepoRef(ref);
	if (!parsed || !parsed.owner || !parsed.repo) {
		return {
			ok: false,
			message:
				"Could not parse the repo reference. Usage: /loop-pull <github-repo-url-or-owner/repo>\n" +
				"e.g. /loop-pull https://github.com/AntonLapshin/ape-kingdom",
		};
	}
	const { owner, repo } = parsed;
	const repoFullName = `${owner}/${repo}`;
	notify(`Pulling ${repoFullName}...`);

	// 1. Verify the repo exists (and is an auto-pi project, checked after clone).
	const info = await repoCheck(owner, repo);
	if (!info.exists) {
		return {
			ok: false,
			message: `Repo ${repoFullName} not found on GitHub (${info.error || "unknown error"}). Check the URL and that you are authenticated with \`gh auth login\`.`,
		};
	}
	notify(`Repo found: https://github.com/${repoFullName} (${info.visibility || "visibility unknown"}).`);

	// 2. One active project per machine. Since `/loop-stop` only pauses the loop
	// (it preserves the active-project record), pulling a project onto this
	// machine must stop the currently-active project's loop first so the pulled
	// project becomes the active one — matching the `/loop-seed` behavior. The
	// old project's workspace/state are preserved and can be switched back to.
	const activeRes = await readActiveProject(currentProjectFile);
	if (activeRes.ok && activeRes.active.workspace) {
		const active = activeRes.active;
		if (active.workspace === workspaceFor(owner, repo, workspacesDir)) {
			// Already pulled & active — nothing to do.
			return {
				ok: true,
				workspace: active.workspace,
				repo: repoFullName,
				message: `Project ${repoFullName} is already pulled and active on this machine (${active.workspace}).`,
			};
		}
		notify(`A project is already active ("${active.projectName || active.repo}" @ ${active.repo || active.workspace}). Stopping its loop before pulling...`);
		await writeStopFile(active.workspace);
		const lock = await checkLock(active.workspace);
		if (lock.locked) {
			notify(`Waiting for the current loop (PID ${lock.pid}) to exit...`);
			const wait = await waitForLoopExit(active.workspace, 60_000, 1500);
			if (!wait.ok) {
				return {
					ok: false,
					message: `Timed out waiting for the active project's loop (PID ${wait.pid}) to exit. It has been asked to stop and will exit on its own; run /loop-pull again shortly.`,
				};
			}
		}
	}

	// 3. Confirm the pull (interactive escape hatch; defaults to proceed).
	if (opts.confirmPull || io.confirmPull) {
		const confirm = opts.confirmPull || io.confirmPull;
		const confirmed = await confirm(repoFullName);
		if (!confirmed) {
			return { ok: false, message: `/loop-pull cancelled for ${repoFullName}.` };
		}
	}

	// 4. Clone into the workspace (same layout as /loop-seed).
	const workspace = workspaceFor(owner, repo, workspacesDir);
	const cloneRes = await cloneProject(workspace, owner, repo, { url: opts.cloneUrl });
	if (!cloneRes.ok) {
		return { ok: false, message: cloneRes.message };
	}
	notify(cloneRes.message);

	// 5. Verify it is an auto-pi project: the committed `.pi/config.json` is the
	// marker. (`.pi/state/initiation.json` is git-ignored, so we regenerate it.)
	const cfgRes = await readProjectConfig(workspace);
	if (!cfgRes.ok) {
		return { ok: false, message: `${cfgRes.error}\n\n"${repoFullName}" does not look like an auto-pi project (no committed .pi/config.json). Use /loop-seed to create a new project instead.` };
	}
	const config = cfgRes.config;

	// M13: validate the pulled config against the harness schema. A broken
	// config fails fast so the project never starts with invalid settings.
	const cfgValid = validateConfig(config);
	if (!cfgValid.ok) {
		return { ok: false, message: `Pulled config failed validation: ${cfgValid.errors.join("; ")}` };
	}

	// 6. Recreate the git-ignored initiation marker so the loop-recognition
	// helpers see this as a locally-seeded project.
	const initRes = await ensureInitiationState(workspace, config);
	if (!initRes.ok) {
		return { ok: false, message: initRes.message };
	}

	// 7. Record the active project.
	const written = await writeActiveProjectRecord(
		{
			projectName: config?.project?.name || repo,
			repo: repoFullName,
			workspace,
		},
		currentProjectFile,
	);
	if (!written.ok) {
		return { ok: false, message: written.message };
	}
	notify(`Workspace ready: ${workspace}`);
	notify(`Active project recorded: ${repoFullName}`);

	// 8. Start the autonomous loop (matching /loop-seed auto-start). Disabled via
	// opts.startLoop=false for tests / callers that handle it elsewhere.
	if (opts.startLoop !== false) {
		const started = await startLoopDetached(workspace);
		if (started.ok) {
			notify(`Autonomous loop started (PID ${started.pid}); log: .pi/logs/loop.out`);
		} else {
			notify(
				`Could not auto-start the loop: ${started.message}. Start it later with \`/loop\` or \`npm run loop\`.`,
				"warning",
			);
		}
	}

	return {
		ok: true,
		workspace,
		repo: repoFullName,
		message: `Pulled ${repoFullName} into ${workspace}. It is now the active project — use /loop-switch, /loop-status, /loop-logs, /loop-restart, etc. exactly as if it had been seeded here.`,
	};
}
