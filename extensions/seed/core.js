/**
 * Shared core for the auto-pi `/seed` initiation flow (M2).
 *
 * Orchestrates: one-project-per-machine enforcement → clarification → repo
 * naming (existence check + fallbacks) → repo creation → local clone/workspace →
 * project scaffold (M3) → project config copy (M5) → `.pi/` state → active-project record.
 *
 * UI is injected by the caller so the same flow drives both the interactive
 * `/seed` command and the `npm run seed` fallback CLI:
 *
 *   {
 *     askQuestions: async (questions) => answers | { usedAssumptions: true },
 *     confirmRepo:  async (name, visibility) => boolean,
 *     chooseRepo:   async (candidates) => string | undefined,
 *     notify:       (text, level?) => void,
 *   }
 *
 * Plain JS on purpose — imported by `extensions/seed/index.ts` (via jiti) and
 * `scripts/seed.js` (via node), matching the doctor milestone convention.
 */

import { join, basename, dirname } from "node:path";
import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execa } from "execa";
import {
	AUTO_PI_DIR,
	CURRENT_PROJECT_FILE,
	WORKSPACES_DIR,
	DEFAULT_VISIBILITY,
	DEFAULT_BRANCH,
	INITIATION_STATE_VERSION,
	PROJECT_STATUS,
} from "./constants.js";
import { buildQuestions, applyAnswers } from "./clarify.js";
import {
	deriveRepoName,
	alternativeNames,
	repoExists,
} from "./repo-name.js";
import { scaffoldProject, buildContext } from "./scaffold.js";
import { writeProjectConfig } from "./config.js";

/** Unique marker used to detect an empty (no user input) clarification pass. */
const USE_ASSUMPTIONS = Symbol("use-assumptions");

/** Run a `gh` command safely. @returns {{ ok, stdout, stderr, exitCode }} */
async function gh(args, opts = {}) {
	try {
		const res = await execa("gh", args, { reject: false, timeout: 30000, ...opts });
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err?.message || err), exitCode: 1 };
	}
}

/** Parse the authenticated GitHub account/login from `gh`. */
export async function getGithubOwner() {
	const res = await gh(["api", "user", "-q", ".login"]);
	return res.ok ? res.stdout.trim() : "";
}

/**
 * The refusal message for "one project per machine" (plan.md §2.2 / README).
 * @param {object} active  current-project.json contents
 */
export function activeProjectRefusal(active) {
	return (
		`Another auto-pi project is already active on this machine: ` +
		`"${active.projectName}" (${active.repo}).\n\n` +
		`The harness enforces exactly one active project per machine at a time so the ` +
		`loop's state, lock file, and budget accounting stay unambiguous.\n\n` +
		`Use \`/stop\` (or \`npm run stop\`) to finish that project, then run \`/seed\` again.`
	);
}

/** Read current-project.json (returns null when absent/invalid). */
export async function readCurrentProject(currentProjectFile = CURRENT_PROJECT_FILE) {
	try {
		const raw = await readFile(currentProjectFile, "utf8");
		const data = JSON.parse(raw);
		if (data && data.projectName) return data;
		return null;
	} catch {
		return null;
	}
}

/**
 * Ensure the per-machine workspace (~/.auto-pi) exists and is writable.
 * Returns { ok, message }.
 */
export async function ensureWorkspaceDir(autoPiDir = AUTO_PI_DIR) {
	try {
		await mkdir(autoPiDir, { recursive: true });
		await access(autoPiDir, fsConstants.W_OK | fsConstants.R_OK);
		return { ok: true, message: autoPiDir };
	} catch (err) {
		return { ok: false, message: `Cannot create/write ${autoPiDir}: ${err?.message || err}` };
	}
}

/**
 * Map a project name to a deterministic local workspace path:
 * `~/.auto-pi/workspaces/{repo-slug}/repo`. Uses the (sanitized) repo name for
 * a stable dir.
 */
export function workspaceFor(repoName, owner, workspacesDir = WORKSPACES_DIR) {
	return join(workspacesDir, owner || "gh", repoName, "repo");
}

/**
 * Turn a repo slug (e.g. "build-a-notes-app") into a human-friendly display
 * name (e.g. "Build A Notes App"). Used for the scaffolded project's title.
 */
export function humanizeName(repoName) {
	return String(repoName ?? "")
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(" ");
}

/**
 * Load config.github settings from config/config.default.json at seed time.
 * (Detailed project config copy is M5; here we only need the github knobs.)
 */
export async function loadGithubConfig() {
	try {
		const raw = await readFile(
			join(new URL("../../config/config.default.json", import.meta.url).pathname),
			"utf8",
		);
		const cfg = JSON.parse(raw);
		return {
			autoCreateRepo: cfg?.github?.autoCreateRepo ?? true,
			repoVisibility: cfg?.github?.repoVisibility ?? DEFAULT_VISIBILITY,
		};
	} catch {
		return { autoCreateRepo: true, repoVisibility: DEFAULT_VISIBILITY };
	}
}

/**
 * Write {workspace}/.pi/state/initiation.json (plan.md §8.2 schema).
 */
async function writeInitiationState(workspace, state) {
	const stateDir = join(workspace, ".pi", "state");
	await mkdir(stateDir, { recursive: true });
	const payload = {
		version: INITIATION_STATE_VERSION,
		projectName: state.projectName,
		description: state.description,
		repo: {
			owner: state.owner,
			name: state.repoName,
			fullName: `${state.owner}/${state.repoName}`,
			alternativesConsidered: state.alternativesConsidered || [],
			existed: Boolean(state.repoExisted),
		},
		workspace,
		clarification: state.clarification,
		createdAt: state.createdAt,
		updatedAt: new Date().toISOString(),
		status: "initiated",
	};
	await writeFile(join(stateDir, "initiation.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
	return payload;
}

/**
 * Serialize the "one active project" record to ~/.auto-pi/current-project.json.
 */
async function writeActiveProject(state, currentProjectFile = CURRENT_PROJECT_FILE) {
	const payload = {
		projectName: state.projectName,
		repo: `${state.owner}/${state.repoName}`,
		workspace: state.workspace,
		startedAt: state.startedAt,
		status: PROJECT_STATUS.ACTIVE,
	};
	await mkdir(dirname(currentProjectFile), { recursive: true });
	await writeFile(currentProjectFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
	return payload;
}

/** Run a remote `git clone` of owner/repoName into the workspace path. */
async function cloneRepo(workspace, repoName, owner, repoFullName) {
	const parent = join(workspace, ".."); // .../{owner}/{repoName}
	const destDir = basename(workspace); // "repo"
	await mkdir(parent, { recursive: true });
	// Clone from the GitHub URL (works with https auth via gh).
	const url = `https://github.com/${repoFullName}.git`;
	const res = await execa("git", ["clone", url, destDir], {
		cwd: parent,
		reject: false,
		timeout: 120000,
	});
	if (res.exitCode !== 0) {
		// Fallback: init an empty repo locally and point it at the remote.
		// git clone cleans up its own partial output on failure, but be defensive
		// and remove anything left behind before re-initialising.
		await rm(workspace, { recursive: true, force: true }).catch(() => {});
		await mkdir(workspace, { recursive: true });
		await execa("git", ["init", "-b", DEFAULT_BRANCH], { cwd: workspace, reject: false });
		await execa("git", ["remote", "add", "origin", url], { cwd: workspace, reject: false });
		res.error = `clone failed (${res.stderr?.trim() || res.exitCode}); initialized locally with origin -> ${repoFullName}`;
	}
	return res;
}

/**
 * Main `/seed` orchestration.
 *
 * @param {string} description the text after `/seed`
 * @param {object} io          injected UI handlers (see module docblock)
 * @param {object} [opts]      { owner?, githubConfig? } for tests/overrides
 * @returns {Promise<{ ok: boolean, message: string, state?: object }>}
 */
export async function runSeed(description, io = {}, opts = {}) {
	const notify = io.notify || ((t) => process.stdout.write(t + "\n"));
	const descriptionText = String(description ?? "").trim();

	// 0. Preconditions: machine workspace available; gh authenticated respected.
	const wsOk = await ensureWorkspaceDir(opts.autoPiDir);
	if (!wsOk.ok) {
		return { ok: false, message: wsOk.message };
	}

	// 1. One active project per machine (refuse if another is active).
	const active = await readCurrentProject(opts.currentProjectFile);
	if (active) {
		return { ok: false, message: activeProjectRefusal(active) };
	}

	// 2. Resolve the GitHub account that will own the repo.
	const owner = opts.owner || (await getGithubOwner());
	if (!owner) {
		return {
			ok: false,
			message:
				"Could not determine your GitHub account. Run `gh auth login`, then `gh auth status`, then try /seed again.",
		};
	}
	notify(`GitHub account: ${owner}`);

	// 3. Clarification (3–6 questions; "use assumptions" escape hatch).
	const githubCfg = opts.githubConfig || (await loadGithubConfig());
	const questions = buildQuestions(descriptionText);
	let clarification;
	if (io.askQuestions) {
		const answer = await io.askQuestions(questions);
		if (answer === USE_ASSUMPTIONS || (answer && answer.usedAssumptions)) {
			clarification = applyAnswers(questions, {}, true);
			notify("Using assumptions for clarification (no human input).");
		} else {
			clarification = applyAnswers(questions, answer || {}, false);
		}
	} else {
		clarification = applyAnswers(questions, {}, true);
		notify("No interactive prompt available; using assumptions for clarification.");
	}

	// 4. Repo naming: derive, check existence, fall back.
	let repoName = deriveRepoName(descriptionText || clarification.answers.interface || "project");
	if (!repoName) repoName = "project";
	const baseExists = await repoExists(repoName, owner, gh);
	const alternatives = baseExists.exists ? alternativeNames(repoName) : [];
	let alternativesConsidered = [repoName];

	// If the derived name is taken, fall back through alternatives in order.
	if (baseExists.exists) {
		// Find the first *free* alternative.
		let chosen = null;
		for (const alt of alternatives) {
			alternativesConsidered.push(alt);
			if (chosen) continue; // already found a free one; just record the rest
			const altExists = await repoExists(alt, owner, gh);
			if (!altExists.exists) chosen = alt;
		}
		if (!chosen) {
			if (io.chooseRepo) {
				const pick = await io.chooseRepo([...alternatives, "type a custom name"]);
				if (pick && pick !== "type a custom name") chosen = pick;
			}
			if (!chosen) {
				return {
					ok: false,
					message: `The repo name "${repoName}" (and fallbacks ${alternatives.join(", ")}) are all taken. No free name could be chosen.`,
				};
			}
			repoName = chosen;
		} else if (githubCfg.autoCreateRepo) {
			// autoCreateRepo: accept the first free alternative automatically.
			notify(`"${repoName}" already exists; using "${chosen}" (autoCreateRepo).`);
			repoName = chosen;
		} else {
			// autoCreateRepo off: propose the free alternative and let the user pick.
			if (io.chooseRepo) {
				const pick = await io.chooseRepo([chosen, ...alternatives.filter((a) => a !== chosen)]);
				if (pick && pick !== "type a custom name") repoName = pick;
				else repoName = chosen;
			} else {
				repoName = chosen;
			}
		}
	}

	const repoFullName = `${owner}/${repoName}`;
	const visibility = githubCfg.repoVisibility === "public" ? "public" : "private";

	// M4 / plan.md §12.4: warn early if Pages is likely to be blocked. GitHub
	// Pages is only available for public repos on the free plan (Pro/Team allow
	// private Pages). If the repo is private, surface the limitation up front so
	// the user is not surprised later when the deploy workflow fails.
	if (visibility === "private") {
		notify(
			"Note: this repo is private. GitHub Pages is only available for public " +
				"repositories on the free plan — the Pages demo may be blocked until the " +
				"repo is made public (or the plan supports private Pages).",
			"warning",
		);
	}

	// 5. Confirm repo creation (proposal / ask for confirmation).
	if (io.confirmRepo && repoName) {
		const confirmed = await io.confirmRepo(repoFullName, visibility);
		if (!confirmed) {
			return { ok: false, message: `/seed cancelled — repo creation for ${repoFullName} was not confirmed.` };
		}
	}

	// 6. Create the repo via gh.
	notify(`Creating repo ${repoFullName} (${visibility})...`);
	const createRes = await gh([
		"repo", "create", repoFullName,
		"--" + visibility,
		"--add-readme", // give it a main branch so cloning is clean
	]);
	if (!createRes.ok) {
		return {
			ok: false,
			message: `Failed to create GitHub repo ${repoFullName}: ${createRes.stderr?.trim() || createRes.stdout?.trim() || createRes.exitCode}`,
		};
	}
	notify(`Repo created: https://github.com/${repoFullName}`);

	// 7. Local workspace + clone.
	const workspace = workspaceFor(repoName, owner, opts.workspacesDir);
	await cloneRepo(workspace, repoName, owner, repoFullName);

	// 7b. Scaffold the React + Tailwind + TypeScript project into the repo (M3).
	// The freshly-cloned repo only has a README (from `--add-readme`); we
	// overwrite it and generate the full project skeleton. Project name is
	// humanised from the repo slug for a friendly display name.
	const projectName = humanizeName(repoName);
	const scaffoldContext = buildContext({
		projectName,
		owner,
		repo: repoName,
		description: descriptionText,
	});
	const scaffoldRes = await scaffoldProject(workspace, scaffoldContext, opts);
	if (!scaffoldRes.ok) {
		return {
			ok: false,
			message:
				`Scaffold failed in ${workspace}:\n` +
				scaffoldRes.errors.map((e) => `  - ${e}`).join("\n"),
		};
	}
	notify(`Scaffolded project (${scaffoldRes.files.length} files) in ${workspace}.`);

	// 7c. Project config copy (M5): copy config.default.json to .pi/config.json,
	// fill project-specific values, and generate the git-ignored local-secrets
	// scaffold (.pi/local.example.json + .pi/config.schema.json reference).
	const configRes = await writeProjectConfig(workspace, {
		projectName,
		repo: repoName,
		owner,
		demoUrl: scaffoldContext.demo_url,
		defaultBranch: DEFAULT_BRANCH,
	});
	if (!configRes.ok) {
		return {
			ok: false,
			message:
				`Config copy failed in ${workspace}:
` + configRes.errors.map((e) => `  - ${e}`).join("\n"),
		};
	}
	notify(`Wrote project config (${configRes.files.length} files) in ${workspace}/.pi.`);

	// 8. `.pi/` state directory inside the workspace + initiation.json.
	const createdAt = new Date().toISOString();
	const state = await writeInitiationState(workspace, {
		projectName: repoName,
		description: descriptionText,
		owner,
		repoName,
		repoExisted: baseExists.exists,
		alternativesConsidered,
		clarification,
		workspace,
		createdAt,
	});

	// 9. Record the active project.
	await writeActiveProject(
		{
			projectName: repoName,
			owner,
			repoName,
			workspace,
			startedAt: createdAt,
		},
		opts.currentProjectFile,
	);

	notify(`Workspace ready: ${workspace}`);
	notify(`Active project recorded: ${repoFullName}`);

	// 10. Start the autonomous loop (M6, plan.md §13.1). Launch it detached under
	// nohup so /seed returns immediately and the loop runs in the background:
	//
	//   nohup node scripts/loop.js > .pi/logs/loop.out 2>&1 &
	//
	// The loop acquires the per-project lock, scans GitHub, dispatches a persona,
	// and runs fresh sessions. `opts.startLoop=false` disables auto-start (tests).
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
		message: `Initiated ${repoFullName} in ${workspace}.`,
		state: { ...state, workspace, repo: repoFullName },
	};
}

/**
 * Launch the loop process detached under nohup (plan.md §13.1 / `npm run loop`
 * auto-start during /seed). The loop script resolves the active project itself,
 * so we only need to give it the workspace cwd and redirect output to the loop
 * log.
 *
 * @param {string} workspace absolute project root
 * @returns {Promise<{ ok: boolean, pid?: number, message?: string }>}
 */
export async function startLoopDetached(workspace) {
	const { mkdir } = await import("node:fs/promises");
	const loopScript = join(dirname(new URL(import.meta.url).pathname), "..", "..", "scripts", "loop.js");
	const logFile = join(workspace, ".pi", "logs", "loop.out");
	try {
		await mkdir(join(workspace, ".pi", "logs"), { recursive: true });
		// Redirect output to the loop log and print the background PID.
		const shell = await execa("bash", ["-c", `nohup node "${loopScript}" > "${logFile}" 2>&1 & echo $!`], {
			cwd: workspace,
			reject: false,
		});
		const pid = parseInt((shell.stdout || "").trim(), 10);
		return { ok: true, pid: pid || undefined };
	} catch (err) {
		return { ok: false, message: err?.message || String(err) };
	}
}

/** Re-exported so callers can detect the assumptions escape hatch. */
export { USE_ASSUMPTIONS };
