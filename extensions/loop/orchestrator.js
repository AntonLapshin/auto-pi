/**
 * Loop orchestrator core for the auto-pi autonomous loop (M6, plan.md §13.1).
 *
 * Implements the 11 responsibilities of the infinite loop:
 *
 *   1. read `.pi/config.json`
 *   2. acquire local lock (PID + lock file, one loop per project)
 *   3. check active project
 *   4. check stop file
 *   5. scan GitHub state
 *   6. decide next persona (dispatcher)
 *   7. build minimal context
 *   8. launch fresh Pi persona session
 *   9. log result
 *  10. sleep (`loop.intervalSeconds`)
 *  11. repeat
 *
 * The core is UI/CLI agnostic: `runLoop(workspace, io, opts)` drives one or more
 * cycles and reports via the injected `io`. `scripts/loop.js` runs the infinite
 * loop under nohup; `extensions/loop/index.ts` exposes a `/loop` command that
 * starts (or reports) the loop.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { join } from "node:path";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { scanGithubState, readBudgetUsage, budgetExceeded } from "./state-scanner.js";
import { dispatch } from "./dispatcher.js";
import { prepareRun, runPersonaWithRetry, newRunId } from "./persona-runner.js";
import { runReliabilityChecks } from "./reliability.js";
import { checkConsecutiveFailures, checkCycleBudget, budgetLimits } from "../../skills/budget-guard/core.js";
import { validateConfig } from "../../skills/config/core.js";
import { createGhClient } from "../../skills/github/core.js";
import { buildPmContext } from "./pm-context.js";
import { buildEngineerContext } from "./engineer-context.js";
import { buildReviewContext } from "./review-context.js";
import {
	LOOP_LOCK_REL,
	STOP_FILE_REL,
	LOOP_LOG_REL,
	LOGS_DIR_REL,
	RUNS_LEDGER_REL,
	LOCK_VERSION,
} from "./constants.js";
import {
	appendRunRecord,
	appendErrorRecord,
	writeSummary,
	buildRunRecord,
	readErrors,
	lastRun,
	logPersonaActivity,
	appendEvent,
} from "../../skills/logging/core.js";
import { notifyEvent, setLogger } from "../../skills/telegram-notify/core.js";
/** Default per-machine active-project record (matches seed constants). */
export const CURRENT_PROJECT_FILE = join(homedir(), ".auto-pi", "current-project.json");

/** Parent dir under which each project's local workspace is created (seed). */
export const WORKSPACES_DIR = join(homedir(), ".auto-pi", "workspaces");

/** Resolve absolute paths for a project workspace. */
function paths(workspace) {
	return {
		config: join(workspace, ".pi", "config.json"),
		lock: join(workspace, LOOP_LOCK_REL),
		stop: join(workspace, STOP_FILE_REL),
		log: join(workspace, LOOP_LOG_REL),
		ledger: join(workspace, RUNS_LEDGER_REL),
		stateDir: join(workspace, ".pi", "state"),
		logsDir: join(workspace, ".pi", "logs"),
	};
}

/**
 * Read and parse `{workspace}/.pi/config.json`.
 * @returns {Promise<{ ok: boolean, config?: object, error?: string }>}
 */
export async function readConfig(workspace) {
	const { config } = paths(workspace);
	try {
		const raw = await readFile(config, "utf8");
		return { ok: true, config: JSON.parse(raw) };
	} catch (err) {
		return { ok: false, error: `Cannot read ${config}: ${err?.message || err}` };
	}
}

/**
 * Check whether another loop is already running for this project by reading the
 * PID + lock file. Returns { locked, pid, stale }.
 */
export async function checkLock(workspace) {
	const { lock } = paths(workspace);
	try {
		const raw = await readFile(lock, "utf8");
		const data = JSON.parse(raw);
		const pid = Number(data.pid);
		// A lock is live if its PID is still running.
		if (pid && pid > 0 && isProcessAlive(pid)) {
			return { locked: true, pid, stale: false };
		}
		return { locked: false, pid, stale: true };
	} catch {
		return { locked: false, pid: null, stale: false };
	}
}

/** True when a process with the given PID is alive on this machine. */
function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code === "EPERM"; // exists but not ours
	}
}

/**
 * Acquire the per-project loop lock (plan.md §13.2). Refuses to start a second
 * loop for the same project. Returns { ok, message }.
 */
export async function acquireLock(workspace) {
	const { lock, stateDir } = paths(workspace);
	const current = await checkLock(workspace);
	if (current.locked) {
		return {
			ok: false,
			message: `A loop is already running for this project (PID ${current.pid}). Refusing to start a second loop (plan.md §13.2).`,
		};
	}
	await mkdir(stateDir, { recursive: true });
	const payload = {
		version: LOCK_VERSION,
		pid: process.pid,
		startedAt: new Date().toISOString(),
		workspace,
	};
	await writeFile(lock, JSON.stringify(payload, null, 2) + "\n", "utf8");
	return { ok: true, message: `Loop lock acquired (PID ${process.pid}).` };
}

/**
 * Release the loop lock if we own it (matching PID). Best-effort.
 */
export async function releaseLock(workspace) {
	const { lock } = paths(workspace);
	try {
		const raw = await readFile(lock, "utf8");
		const data = JSON.parse(raw);
		if (Number(data.pid) === process.pid) {
			await rm(lock, { force: true });
			return true;
		}
	} catch {
		// nothing to release
	}
	return false;
}

/**
 * Write the stop file (plan.md §13.3). The loop checks for this file every
 * cycle and exits cleanly. Returns the stop-file path.
 */
export async function writeStopFile(workspace) {
	const { stop, stateDir } = paths(workspace);
	await mkdir(stateDir, { recursive: true });
	await writeFile(stop, `${new Date().toISOString()}\n`, "utf8");
	return stop;
}

/**
 * Check whether the stop file exists (plan.md §13.3).
 * @returns {Promise<boolean>}
 */
export async function isStopped(workspace) {
	return existsSync(paths(workspace).stop);
}

/**
 * Read the active-project record for this machine.
 * @returns {Promise<{ ok: boolean, active?: object, error?: string }>}
 */
export async function readActiveProject(currentProjectFile = CURRENT_PROJECT_FILE) {
	try {
		const raw = await readFile(currentProjectFile, "utf8");
		const data = JSON.parse(raw);
		if (data && data.workspace) return { ok: true, active: data };
		return { ok: false, error: "No active project recorded on this machine." };
	} catch {
		return { ok: false, error: "No active project recorded on this machine." };
	}
}

/**
 * Clear the per-machine active-project record (current-project.json).
 *
 * NOTE: `/loop-stop` no longer calls this — stopping now just pauses the loop
 * and preserves the active-project record so the project can be resumed or
 * restarted. This helper remains for explicit record management (e.g. manual
 * cleanup / tests).
 *
 * Returns { ok, message }.
 */
export async function clearActiveProject(currentProjectFile = CURRENT_PROJECT_FILE) {
	try {
		await rm(currentProjectFile, { force: true });
		return { ok: true, message: `Active-project record cleared: ${currentProjectFile}` };
	} catch (err) {
		return { ok: false, message: `Could not clear active-project record ${currentProjectFile}: ${err?.message || err}` };
	}
}

/**
 * Write the per-machine active-project record (current-project.json) to point
 * at the given project. Used by `/loop-switch` to move the active-project
 * pointer between projects.
 *
 * @param {{ projectName, repo, workspace }} project
 * @param {string} [currentProjectFile]
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function writeActiveProjectRecord(project, currentProjectFile = CURRENT_PROJECT_FILE) {
	const { mkdir } = await import("node:fs/promises");
	const { dirname } = await import("node:path");
	const payload = {
		projectName: project.projectName || project.repo || "",
		repo: project.repo || "",
		workspace: project.workspace,
		startedAt: new Date().toISOString(),
		status: "active",
	};
	try {
		await mkdir(dirname(currentProjectFile), { recursive: true });
		await writeFile(currentProjectFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
		return { ok: true, message: `Active-project record written: ${currentProjectFile}` };
	} catch (err) {
		return { ok: false, message: `Could not write active-project record ${currentProjectFile}: ${err?.message || err}` };
	}
}

/**
 * List the projects that exist locally under the workspaces dir
 * (`~/.auto-pi/workspaces/{owner}/{repoName}/repo`), i.e. projects that were
 * previously seeded and can be switched to.
 *
 * @param {string} [workspacesDir]
 * @returns {Promise<Array<{ owner, repoName, repo, workspace, projectName }>>}
 */
export async function listProjects(workspacesDir = WORKSPACES_DIR) {
	const projects = [];
	try {
		const owners = await readdir(workspacesDir, { withFileTypes: true });
		for (const owner of owners) {
			if (!owner.isDirectory()) continue;
			const ownerDir = join(workspacesDir, owner.name);
			const repos = await readdir(ownerDir, { withFileTypes: true });
			for (const repo of repos) {
				if (!repo.isDirectory()) continue;
				const workspace = join(ownerDir, repo.name, "repo");
				const initFile = join(workspace, ".pi", "state", "initiation.json");
				if (!existsSync(initFile)) continue;
				let projectName = repo.name;
				try {
					const init = JSON.parse(await readFile(initFile, "utf8"));
					if (init?.projectName) projectName = init.projectName;
				} catch {
					// fall back to the repo name
				}
				projects.push({
					owner: owner.name,
					repoName: repo.name,
					repo: `${owner.name}/${repo.name}`,
					workspace,
					projectName,
				});
			}
		}
	} catch {
		// workspaces dir missing/empty — no local projects
	}
	return projects;
}

/**
 * Resolve a `/loop-switch` target string to a locally-existing project.
 *
 * Matches (case-insensitive) against the repo full name (`owner/repo`), the
 * repo slug, or the human-friendly project name. With no target, returns the
 * first local project (so `/loop-switch` with no args lists available projects
 * and switches to the first).
 *
 * @param {string} target
 * @param {string} [workspacesDir]
 * @returns {Promise<object|null>}
 */
export async function resolveProject(target, workspacesDir = WORKSPACES_DIR) {
	const t = String(target || "").trim().toLowerCase();
	const projects = await listProjects(workspacesDir);
	if (!t) return projects[0] || null;
	return (
		projects.find((p) => {
			const full = `${p.owner}/${p.repoName}`.toLowerCase();
			return (
				full === t ||
				p.repoName.toLowerCase() === t ||
				String(p.projectName || "").toLowerCase() === t
			);
		}) || null
	);
}

/**
 * Remove the stop file so the loop stops exiting immediately (plan.md §13.3).
 * Used by `/loop-restart` and `/loop-resume` when re-arming a fresh loop after
 * the marker was written to trigger a clean shutdown.
 *
 * @param {string} workspace
 * @returns {Promise<boolean>} true when the stop file is now absent
 */
export async function removeStopFile(workspace) {
	await rm(paths(workspace).stop, { force: true });
	return !existsSync(paths(workspace).stop);
}

/**
 * Poll until a running loop process (identified by the loop-lock PID) has
 * exited, then confirm the lock is free. The loop is stopped *cooperatively*:
 * writing the stop file makes it exit at its next cycle boundary, and any
 * in-flight persona finishes normally — we never SIGKILL it. This is what makes
 * a restart "safe".
 *
 * @param {string} workspace
 * @param {number} [timeoutMs] total time to wait (default 60s)
 * @param {number} [intervalMs] poll interval (default 1500ms)
 * @returns {Promise<{ ok: boolean, pid: number|null, timedOut: boolean }>}
 */
export async function waitForLoopExit(workspace, timeoutMs = 60_000, intervalMs = 1500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lock = await checkLock(workspace);
		if (!lock.locked) {
			return { ok: true, pid: lock.pid, timedOut: false };
		}
		await sleep(intervalMs);
	}
	const lock = await checkLock(workspace);
	return { ok: !lock.locked, pid: lock.pid, timedOut: lock.locked };
}

/**
 * Launch the loop process detached under `setsid nohup`, mirroring the
 * `/loop-seed` auto-start pattern (extensions/seed/core.js `startLoopDetached`).
 * The loop script resolves the active project itself, so we only need to give it
 * the workspace cwd and redirect output to the loop log. `setsid` places the
 * loop in its own session/process group with no controlling terminal so spawned
 * persona `pi` sessions never inherit the interactive tty.
 *
 * @param {string} workspace absolute project root
 * @returns {Promise<{ ok: boolean, pid?: number, message?: string }>}
 */
export async function startLoopDetached(workspace) {
	const { mkdir } = await import("node:fs/promises");
	const loopScript = new URL("../../scripts/loop.js", import.meta.url).pathname;
	const logFile = join(workspace, LOGS_DIR_REL, "loop.out");
	try {
		await mkdir(join(workspace, LOGS_DIR_REL), { recursive: true });
		// Propagate the resolved provider/model into the detached loop process so
		// it (and every persona it spawns) defaults to the intended model even
		// though nohup does not inherit the interactive session's PI_* env vars.
		const { providerEnv } = await import("./provider-env.js");
		const env = providerEnv();
		const { execa } = await import("execa");
		const shell = await execa("bash", ["-c", `setsid nohup node "${loopScript}" </dev/null > "${logFile}" 2>&1 & echo $!`], {
			cwd: workspace,
			env,
			reject: false,
		});
		const pid = parseInt((shell.stdout || "").trim(), 10);
		return { ok: true, pid: pid || undefined };
	} catch (err) {
		return { ok: false, message: err?.message || String(err) };
	}
}

/**
 * Restart the autonomous loop for the active project — the core of the
 * `/loop-restart` command.
 *
 * Safely stops any existing loop, then starts a fresh one:
 *
 *   1. Write the stop file so the running loop (if any) exits at its next cycle
 *      boundary — a persona in flight finishes normally (no SIGKILL).
 *   2. Wait (poll) for the loop process to actually exit so its lock is released
 *      and it can't fight the new loop for the lock. Times out after
 *      `opts.timeoutMs` (default 60s) and aborts if the old loop hasn't exited —
 *      starting a second loop while the first still runs would fail the lock.
 *   3. Remove the stop file so the fresh loop doesn't immediately exit.
 *   4. Start a new loop detached (`setsid nohup`).
 *
 * Unlike `/loop-stop`, the active-project record is preserved — the project is
 * restarted, not finished — so the new loop resumes the same project.
 *
 * @param {string} workspace absolute project root
 * @param {object} [opts] { log?, timeoutMs?, intervalMs?, start? }
 * @returns {Promise<{ ok: boolean, pid?: number, message: string, wasRunning: boolean, timedOut?: boolean }>}
 */
export async function restartLoop(workspace, opts = {}) {
	const log = opts.log || ((line) => process.stdout.write(`[loop-restart] ${line}\n`));
	const timeoutMs = Number(opts.timeoutMs) || 60_000;
	const intervalMs = Number(opts.intervalMs) || 1500;
	const start = opts.start || startLoopDetached;

	// 1. Request a clean stop.
	await writeStopFile(workspace);
	log("stop file written — requesting the running loop to stop safely.");

	// 2. Wait for the running loop (if any) to exit so the new loop can own the lock.
	const initial = await checkLock(workspace);
	let wasRunning = Boolean(initial.locked);
	if (initial.locked) {
		log(`waiting for loop PID ${initial.pid} to exit (up to ${Math.round(timeoutMs / 1000)}s)...`);
		const wait = await waitForLoopExit(workspace, timeoutMs, intervalMs);
		if (!wait.ok) {
			// Abort rather than risk a double loop. Leave the stop file in place so
			// the still-running loop exits on its own once the current cycle ends.
			log(`timed out waiting for loop PID ${wait.pid} to exit — aborting restart.`);
			return {
				ok: false,
				message: `Timed out waiting for the running loop (PID ${wait.pid}) to exit. It may still be running a persona. The loop has been asked to stop and will exit on its own; run /loop-restart again shortly.`,
				timedOut: true,
				wasRunning: true,
				pid: wait.pid,
			};
		}
		log(`loop exited cleanly (PID ${initial.pid}).`);
	} else if (initial.stale) {
		log("stale lock found — cleaning up before restart.");
	}

	// 3. Remove the stop file so the fresh loop runs rather than exiting.
	await removeStopFile(workspace);

	// 4. Start a new loop detached.
	const started = await start(workspace);
	if (!started.ok) {
		log(`failed to start the loop: ${started.message || "unknown error"}`);
		return { ok: false, wasRunning, message: `Stopped the old loop but could not start a new one: ${started.message || "unknown error"}` };
	}
	log(`loop started (PID ${started.pid || "?"}).`);
	return {
		ok: true,
		pid: started.pid,
		wasRunning,
		message: `Loop restarted (${wasRunning ? `stopped PID ${initial.pid} and ` : ""}started PID ${started.pid || "?"}). Check .pi/logs/loop.out.`,
	};
}

/**
 * Switch the active project to a different locally-seeded project — the core of
 * the `/loop-switch` command.
 *
 * Safely stops the current project's loop (if any), then points the per-machine
 * active-project record at the target project and (optionally) starts its loop.
 *
 *   1. Resolve the target from the local workspaces dir (repo slug / full name /
 *      project name).
 *   2. If we're already on that project, report and return.
 *   3. Write the stop file for the current project so its loop (if running)
 *      exits at its next cycle boundary — a persona in flight finishes normally
 *      (never SIGKILLed). Wait (poll) for it to actually exit so its lock is
 *      released and it can't fight the new project.
 *   4. Rewrite current-project.json to point at the target project.
 *   5. Clear any stale stop marker on the target, then start its loop detached
 *      (unless `opts.startLoop === false`).
 *
 * The current project is NOT removed — its workspace, state, and lock remain
 * intact so it can be switched back to at any time.
 *
 * @param {string} target repo slug / full name / project name to switch to
 * @param {object} [io] { log?, notify? }
 * @param {object} [opts] { timeoutMs?, intervalMs?, start?, startLoop?, workspacesDir?, currentProjectFile? }
 * @returns {Promise<{ ok: boolean, message: string, target?: object, currentWorkspace?: string|null }>}
 */
export async function switchProject(target, io = {}, opts = {}) {
	const log = opts.log || io.log || ((line) => process.stdout.write(`[loop-switch] ${line}\n`));
	const notify = io.notify || log;
	const timeoutMs = Number(opts.timeoutMs) || 60_000;
	const intervalMs = Number(opts.intervalMs) || 1500;
	const start = opts.start || startLoopDetached;
	const workspacesDir = opts.workspacesDir || WORKSPACES_DIR;
	const currentProjectFile = opts.currentProjectFile || CURRENT_PROJECT_FILE;

	// 1. Resolve the target project from existing local workspaces.
	const resolved = await resolveProject(target, workspacesDir);
	if (!resolved) {
		return {
			ok: false,
			message: `No local project matches "${target}". Use /loop-seed to create a new project, or /loop-switch with no args to list available projects.`,
		};
	}

	// 2. Read the current active project (may be absent).
	const activeRes = await readActiveProject(currentProjectFile);
	const currentWorkspace = activeRes.ok ? activeRes.active.workspace : null;

	// Already on the target project.
	if (currentWorkspace && currentWorkspace === resolved.workspace) {
		return {
			ok: true,
			currentWorkspace,
			target: resolved,
			message: `Already on project "${resolved.projectName}" (${resolved.repo}).`,
		};
	}

	// 3. Safely stop the current project's loop (if any).
	if (currentWorkspace) {
		log(`stopping current project's loop (${currentWorkspace})...`);
		await writeStopFile(currentWorkspace);
		const initial = await checkLock(currentWorkspace);
		if (initial.locked) {
			log(`waiting for loop PID ${initial.pid} to exit (up to ${Math.round(timeoutMs / 1000)}s)...`);
			const wait = await waitForLoopExit(currentWorkspace, timeoutMs, intervalMs);
			if (!wait.ok) {
				// Leave the stop file in place so the still-running loop exits on its
				// own at its next cycle; the record is unchanged so nothing is lost.
				return {
					ok: false,
					currentWorkspace,
					message: `Timed out waiting for the current loop (PID ${wait.pid}) to exit. It has been asked to stop and will exit on its own; run /loop-switch again shortly.`,
				};
			}
			log(`current loop exited cleanly (PID ${initial.pid}).`);
		}
	}

	// 4. Point the active-project record at the target.
	const written = await writeActiveProjectRecord(
		{ projectName: resolved.projectName, repo: resolved.repo, workspace: resolved.workspace },
		currentProjectFile,
	);
	if (!written.ok) {
		return { ok: false, currentWorkspace, message: written.message };
	}
	log(`active-project record now points at ${resolved.repo}.`);

	// 5. Optionally start the target's loop. Clear any stale stop marker first so
	// the freshly-started loop runs rather than immediately exiting (the target
	// may have been paused/stopped previously).
	if (opts.startLoop !== false) {
		await removeStopFile(resolved.workspace);
		const started = await start(resolved.workspace);
		if (started.ok) {
			notify(`Switched to ${resolved.repo}; loop started (PID ${started.pid || "?"}). Check .pi/logs/loop.out.`);
		} else {
			notify(
				`Switched to ${resolved.repo}, but could not auto-start its loop: ${started.message || "unknown error"}. Use /loop-resume to start it.`,
				"warning",
			);
		}
	} else {
		notify(`Switched to ${resolved.repo}. Use /loop-resume to start its loop.`);
	}

	return {
		ok: true,
		currentWorkspace,
		target: resolved,
		message: `Switched active project to ${resolved.repo} (${resolved.workspace}).`,
	};
}

/**
 * Check whether the project's initiation/state requires a human decision.
 * Looks for a `pi:needs-human` / `pi:blocked` open issue (plan.md §15 step 3).
 * Also honours an explicit needs-human marker in initiation.json.
 */
export async function needsHuman(workspace, state) {
	if (state?.issues?.some((i) => i.labels.includes("pi:needs-human") || i.labels.includes("pi:blocked"))) {
		return true;
	}
	// Fallback: initiation.json may carry a blocked/needs-human status.
	try {
		const raw = await readFile(join(workspace, ".pi", "state", "initiation.json"), "utf8");
		const init = JSON.parse(raw);
		const status = String(init?.status || "").toLowerCase();
		return status === "needs-human" || status === "blocked";
	} catch {
		return false;
	}
}

/**
 * Best-effort read of the local completion marker the PM writes when the
 * project is done (plan.md §24, personas/pm.md Step 4). Absent → not done.
 * @param {string} workspace
 * @returns {Promise<{ status: string, completedAt?: string, repo?: string, demoUrl?: string }>}
 */
async function readCompletedState(workspace) {
	try {
		const raw = await readFile(join(workspace, ".pi", "state", "completed.json"), "utf8");
		const data = JSON.parse(raw);
		if (data && data.status === "done") return data;
	} catch {
		// no completion marker yet
	}
	return null;
}

/**
 * Send a Telegram lifecycle notification, best-effort (M11). Never throws and
 * never breaks the loop — it is a silent no-op when disabled or env vars are
 * absent. Logs only a redacted (secret-free) activity line via the injected io.
 */
async function notify(workspace, config, event, reason, io, completed) {
	try {
		const log = io?.log || ((line) => process.stdout.write(`[loop] ${line}\n`));
		setLogger((line) => log(line));
		await notifyEvent({ workspace, config, event: event, reason: reason || "", completed });
	} catch {
		// notifications are best-effort and must never break the loop
	}
}

/**
 * Run a single loop cycle for the active project.
 *
 * @param {string} workspace absolute project root
 * @param {object} [io]      { log: (line, level?) => void }
 * @param {object} [opts]    { gh?, currentProjectFile?, dryRun?, env? } for tests
 * @returns {Promise<{
 *   ok: boolean,
 *   decision?: string,
 *   persona?: string,
 *   reason?: string,
 *   action: "ran"|"stopped"|"waiting"|"noop"|"error",
 *   message: string
 * }>}
 */
export async function runLoopCycle(workspace, io = {}, opts = {}) {
	const log = io.log || ((line) => process.stdout.write(`[loop] ${line}\n`));
	// M13: use the resilient gh client (retry/backoff + rate-limit handling) by
	// default so the loop survives transient GitHub/network failures. Tests may
	// inject a fake via opts.gh.
	const ghFn = opts.gh || createGhClient({ onRetry: (info) => log(`gh retry ${info.attempt}: ${info.reason} (backoff ${info.delayMs}ms)`)});

	// 1. Read config.
	const cfgRes = await readConfig(workspace);
	if (!cfgRes.ok) {
		await logCycleError(workspace, { error: cfgRes.error, action: "error" }, {});
		return { ok: false, action: "error", message: cfgRes.error };
	}
	const config = cfgRes.config;

	// M13: validate config against the harness schema at loop start. An invalid
	// config fails fast with a clear message instead of silently misbehaving.
	const valid = validateConfig(config);
	if (!valid.ok) {
		const msg = `Invalid .pi/config.json: ${valid.errors.join("; ")}`;
		await logCycleError(workspace, { error: msg, action: "error" }, config);
		return { ok: false, action: "error", message: msg };
	}

	// 2. Acquire local lock (refuse a second loop for the same project).
	const lockRes = await acquireLock(workspace);
	if (!lockRes.ok) {
		return { ok: false, action: "error", message: lockRes.message };
	}

	try {
		// 4. Check stop file.
		const stopped = await isStopped(workspace);

		// 3. Check active project.
		const activeRes = await readActiveProject(opts.currentProjectFile);
		if (!activeRes.ok) {
			await logCycleError(workspace, { error: activeRes.error, action: "error" }, config);
			return { ok: false, action: "error", message: activeRes.error };
		}
		const active = activeRes.active;
		const owner = active.repo?.split("/")[0] || config.project?.owner || "";
		const repo = active.repo?.split("/")[1] || config.project?.repo || "";

		// 5. Scan GitHub state.
		const scanRes = await scanGithubState(owner, repo, ghFn);
		if (!scanRes.ok) {
			await logCycleError(workspace, { error: `State scan failed: ${scanRes.error}`, action: "error" }, config);
			return { ok: false, action: "error", message: `State scan failed: ${scanRes.error}` };
		}
		const state = scanRes.state;

		// M13: run reliability checks (stale branch cleanup + conflict labelling
		// + issue-attempt-limit enforcement) best-effort each cycle. Never throws;
		// failures are logged and ignored.
		await runReliabilityChecks(owner, repo, ghFn, { log }, {
			workspace,
			config,
			state,
		}).catch(() => {});

		// Budget usage for the dispatch decision.
		const usage = await readBudgetUsage(workspace);
		const budget = budgetExceeded(config, usage);

		// M13: honour `loop.stopOnBudgetExceeded` (default true). When set to
		// false, a budget overrun is logged as a warning but does NOT stop the
		// loop — it keeps running so the project can still make progress (plan.md
		// §21 / M13 budget guardrails).
		const stopOnBudget = config?.loop?.stopOnBudgetExceeded !== false;
		const effectiveBudget = budget?.exceeded && !stopOnBudget
			? { exceeded: false, reason: `budget exceeded but loop.stopOnBudgetExceeded=false (${budget.reason})` }
			: budget;
		if (budget?.exceeded && !stopOnBudget) {
			log(`warning: ${effectiveBudget.reason} — continuing because loop.stopOnBudgetExceeded=false`);
		}

		// M13: enforce the consecutive-failure limit (loop.maxConsecutiveFailures).
		// When the last N cycles all errored, stop with a repeated-failure reason.
		const recentFailures = await consecutiveFailureCount(workspace);
		const failureStop = checkConsecutiveFailures(config, recentFailures);

		// 6. Decide next persona.
		const decision = dispatch({
			stopped,
			budget: failureStop.exceeded ? failureStop : effectiveBudget,
			needsHuman: await needsHuman(workspace, state),
			state,
			config,
			// The project is considered "done" when the PM has written the
			// completion marker. When done and there is no open work, the loop
			// WAITs at zero cost rather than re-spawning the PM to finalize.
			completed: Boolean(await readCompletedState(workspace)),
		});
		log(`dispatch: ${decision.decision} (${decision.reason})`);
		await appendEvent(workspace, {
			type: "loop.dispatch",
			persona: decision.persona || "",
			data: {
				decision: decision.decision,
				reason: decision.reason,
				openIssues: (state?.issues || []).length,
				openPrs: (state?.prs || []).length,
			},
		}, config).catch(() => {});

		if (decision.decision === "stop") {
			await appendEvent(workspace, {
				type: "loop.stop",
				data: { reason: decision.reason, budgetExceeded: Boolean(budget?.exceeded) },
			}, config).catch(() => {});
			await logCycleResult(workspace, config, {
				action: "stopped",
				status: "stopped",
				reason: decision.reason,
				persona: decision.persona,
			}, state);
			// M11: notify on loop stop — budget stop always; manual stop only if
			// `notifyOnStopped` is set (the stop-file case).
			const stoppedManual = Boolean(stopped);
			if (budget && budget.exceeded) {
				await notify(workspace, config, "stopped-budget", decision.reason, io);
			} else if (stoppedManual) {
				await notify(workspace, config, "stopped-manual", decision.reason, io);
			}
			await releaseLock(workspace);
			return { ok: true, action: "stopped", decision: decision.decision, reason: decision.reason, message: `Loop stopped: ${decision.reason}` };
		}
		if (decision.decision === "wait") {
			await appendEvent(workspace, {
				type: "loop.wait",
				data: { reason: decision.reason },
			}, config).catch(() => {});
			await logCycleResult(workspace, config, {
				action: "waiting",
				status: "waiting",
				reason: decision.reason,
				persona: decision.persona,
			}, state);
			// M11: notify when the project needs human attention.
			const needsHumanNow = await needsHuman(workspace, state);
			if (needsHumanNow) {
				await notify(workspace, config, "needs-human", decision.reason, io);
			}
			await releaseLock(workspace);
			return { ok: true, action: "waiting", decision: decision.decision, persona: decision.persona, reason: decision.reason, message: `Waiting: ${decision.reason}` };
		}

		// 7. Build minimal context + 8. launch fresh persona session.
		if (opts.dryRun) {
			await releaseLock(workspace);
			return {
				ok: true,
				action: "ran",
				decision: decision.decision,
				persona: decision.persona,
				reason: decision.reason,
				message: `[dry-run] would run persona "${decision.persona}": ${decision.reason}`,
			};
		}

		const runId = newRunId(decision.persona);

		// PM persona gets its focused context packer (M7, plan.md §21.1); the
		// Engineer persona gets its focused context packer (M8, plan.md §21.1);
		// the Review Engineer persona gets its focused context packer (M9,
		// plan.md §21.1); other personas use the generic minimal context builder.
		const isPm = decision.persona === "pm";
		const isEngineer = decision.persona === "engineer";
		const isReview = decision.persona === "review-engineer";
		const { contextFile } = isPm
			? await prepareRun(workspace, runId, {
					persona: decision.persona,
					decision,
					config,
					state,
					buildContext: (payload) => buildPmContext({
						workspace,
						config: payload.config,
						state: payload.state,
						decision: payload.decision,
						ghFn: opts.gh,
					}),
				})
			: isEngineer
				? await prepareRun(workspace, runId, {
						persona: decision.persona,
						decision,
						config,
						state,
						buildContext: (payload) => buildEngineerContext({
							workspace,
							config: payload.config,
							state: payload.state,
							decision: payload.decision,
							ghFn: opts.gh,
						}),
					})
				: isReview
					? await prepareRun(workspace, runId, {
							persona: decision.persona,
							decision,
							config,
							state,
							buildContext: (payload) => buildReviewContext({
								workspace,
								config: payload.config,
								state: payload.state,
								decision: payload.decision,
								ghFn: opts.gh,
							}),
						})
					: await prepareRun(workspace, runId, {
							persona: decision.persona,
							decision,
							config,
							state,
						});

		log(`running persona "${decision.persona}" (run ${runId})...`);
		// Structured event: a persona has been spawned (the harness has dispatched
		// it and is about to launch a fresh LLM session). The UI uses this to show
		// the currently-active persona.
		await appendEvent(workspace, {
			type: "persona.spawned",
			persona: decision.persona,
			runId,
			data: {
				decision: decision.decision,
				reason: decision.reason,
				model: config?.pi?.model || "",
				provider: config?.pi?.provider || "",
			},
		}, config).catch(() => {});
		// Observability: write a durable "started" activity record (runs.jsonl +
		// latest.log + summary.md) the moment a persona is dispatched, so there is
		// always at least one logged activity per persona even if the run is
		// long-running, hangs, or is later retried. Best-effort; never breaks the
		// loop.
		await logPersonaActivity({
			workspace,
			config,
			state,
			runId,
			persona: decision.persona,
			status: "started",
			action: "started",
			reason: `dispatch ${decision.decision}: ${decision.reason}`,
		}).catch(() => {});
		const result = await runPersonaWithRetry({
			workspace,
			persona: decision.persona,
			runId,
			contextFile,
			config,
			env: opts.env,
			onRetry: (info) => log(`persona retry ${info.attempt}: ${info.reason} (backoff ${info.delayMs}ms)`),
		});

		// 9. Log result (runPersona already appended the ledger line; surface here).
		log(`persona "${decision.persona}" finished (exit ${result.exitCode}, ok=${result.ok}).`);

		// M10: write the execution summary after each persona run.
		await refreshSummary(workspace, config, state).catch(() => {});

		// M11: if the PM just wrote the completion marker, send the "done"
		// notification (project, repo, demo URLs) and stop the loop.
		const completed = await readCompletedState(workspace);
		if (completed) {
			await notify(workspace, config, "done", "project completed", io, completed);
		}

		await releaseLock(workspace);
		return {
			ok: result.ok,
			action: "ran",
			decision: decision.decision,
			persona: decision.persona,
			reason: decision.reason,
			runId,
			runDir: result.runDir,
			tokens: result.tokens,
			message: `Ran persona "${decision.persona}" (${result.ok ? "ok" : "exit " + result.exitCode}).`,
		};
	} catch (err) {
		await releaseLock(workspace).catch(() => {});
		const msg = `Loop cycle error: ${err?.message || err}`;
		await logCycleError(workspace, { error: msg, action: "error" }, config);
		return { ok: false, action: "error", message: msg };
	}
}

/**
 * Count the number of consecutive failed cycles from the run ledger
 * (runs.jsonl). A "failure" is a cycle whose run record has status/action
 * "error" (a persona session that failed or a cycle that errored). Used to
 * enforce `loop.maxConsecutiveFailures` (M13).
 *
 * @param {string} workspace
 * @returns {Promise<number>} consecutive failure count (0 when none / no ledger)
 */
async function consecutiveFailureCount(workspace) {
	try {
		const { readRuns } = await import("../../skills/logging/core.js");
		const runs = await readRuns(workspace);
		let count = 0;
		// Walk backwards from the most recent run; stop at the first non-failure.
		for (let i = runs.length - 1; i >= 0; i--) {
			const r = runs[i];
			const failed = r?.status === "error" || r?.action === "error";
			if (failed) {
				count += 1;
			} else {
				break;
			}
		}
		return count;
	} catch {
		return 0;
	}
}

/**
 * Run the infinite loop for the active project (plan.md §13.1 steps 10–11):
 * run a cycle, sleep `loop.intervalSeconds`, repeat, until the stop file
 * appears or the process is interrupted.
 *
 * @param {string} workspace absolute project root
 * @param {object} [io]      { log }
 * @param {object} [opts]    { cycles?, gh?, currentProjectFile?, env? }
 * @returns {Promise<{ ok: boolean, cycles: number, stopped: boolean }>}
 */
export async function runLoop(workspace, io = {}, opts = {}) {
	const log = io.log || ((line) => process.stdout.write(`[loop] ${line}\n`));
	const cfgRes = await readConfig(workspace);
	if (!cfgRes.ok) {
		log(`error: ${cfgRes.error}`);
		return { ok: false, cycles: 0, stopped: false };
	}
	const intervalSeconds = Math.max(1, Number(cfgRes.config?.loop?.intervalSeconds) || 60);
	const maxCycles = opts.cycles || Infinity;

	let cycles = 0;
	let stopped = false;
	while (cycles < maxCycles) {
		const cycle = await runLoopCycle(workspace, io, opts);
		cycles += 1;
		if (cycle.action === "stopped") {
			stopped = true;
			log(`stop: ${cycle.message}`);
			break;
		}
		if (cycle.action === "error") {
			log(`cycle error: ${cycle.message}`);
		}
		if (cycles >= maxCycles) break;
		log(`sleeping ${intervalSeconds}s...`);
		await sleep(intervalSeconds * 1000);
	}
	return { ok: true, cycles, stopped };
}

/** Promise-based sleep. */
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log a non-persona cycle result (stopped / waiting) as a run record and
 * refresh the execution summary.
 */
async function logCycleResult(workspace, config, { action, status, reason, persona }, state) {
	try {
		const record = buildRunRecord({
			persona: persona || "",
			trigger: "loop",
			projectName: config?.project?.name || "",
			repo: [config?.project?.owner, config?.project?.repo].filter(Boolean).join("/"),
			status,
			action,
			reason: reason || "",
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
		});
		await appendRunRecord(workspace, record, config);
		await refreshSummary(workspace, config, state);
	} catch {
		// logging is best-effort and must never break the loop
	}
}

/**
 * Log a cycle error to errors.jsonl (and runs.jsonl) and refresh the summary.
 */
async function logCycleError(workspace, { error, action = "error" }, config) {
	try {
		await appendErrorRecord(workspace, { error, action }, config);
		const record = buildRunRecord({
			trigger: "loop",
			projectName: config?.project?.name || "",
			repo: [config?.project?.owner, config?.project?.repo].filter(Boolean).join("/"),
			status: "error",
			action,
			reason: "loop error",
			error: String(error || "").slice(0, 2000),
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
		});
		await appendRunRecord(workspace, record, config);
		await refreshSummary(workspace, config, {});
	} catch {
		// best-effort
	}
}

/**
 * Refresh `.pi/logs/summary.md` / `summary.jsonl` from the latest run records,
 * error records, and the scanned GitHub state.
 */
async function refreshSummary(workspace, config, state) {
	const [errors, last] = await Promise.all([readErrors(workspace), lastRun(workspace)]);
	await writeSummary({
		workspace,
		config,
		state: state || {},
		lastRun: last,
		errors: errors.slice(-10),
	});
}
