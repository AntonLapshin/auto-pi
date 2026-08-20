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
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { scanGithubState, readBudgetUsage, budgetExceeded } from "./state-scanner.js";
import { dispatch } from "./dispatcher.js";
import { prepareRun, runPersona, newRunId } from "./persona-runner.js";
import { buildPmContext } from "./pm-context.js";
import { buildEngineerContext } from "./engineer-context.js";
import { buildReviewContext } from "./review-context.js";
import {
	LOOP_LOCK_REL,
	STOP_FILE_REL,
	LOOP_LOG_REL,
	RUNS_LEDGER_REL,
	LOCK_VERSION,
} from "./constants.js";
/** Default per-machine active-project record (matches seed constants). */
export const CURRENT_PROJECT_FILE = join(homedir(), ".auto-pi", "current-project.json");

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
	const ghFn = opts.gh;

	// 1. Read config.
	const cfgRes = await readConfig(workspace);
	if (!cfgRes.ok) {
		return { ok: false, action: "error", message: cfgRes.error };
	}
	const config = cfgRes.config;

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
			return { ok: false, action: "error", message: activeRes.error };
		}
		const active = activeRes.active;
		const owner = active.repo?.split("/")[0] || config.project?.owner || "";
		const repo = active.repo?.split("/")[1] || config.project?.repo || "";

		// 5. Scan GitHub state.
		const scanRes = await scanGithubState(owner, repo, ghFn);
		if (!scanRes.ok) {
			return { ok: false, action: "error", message: `State scan failed: ${scanRes.error}` };
		}
		const state = scanRes.state;

		// Budget usage for the dispatch decision.
		const usage = await readBudgetUsage(workspace);
		const budget = budgetExceeded(config, usage);

		// 6. Decide next persona.
		const decision = dispatch({
			stopped,
			budget,
			needsHuman: await needsHuman(workspace, state),
			state,
			config,
		});
		log(`dispatch: ${decision.decision} (${decision.reason})`);

		if (decision.decision === "stop") {
			await releaseLock(workspace);
			return { ok: true, action: "stopped", decision: decision.decision, reason: decision.reason, message: `Loop stopped: ${decision.reason}` };
		}
		if (decision.decision === "wait") {
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
		const result = await runPersona({
			workspace,
			persona: decision.persona,
			runId,
			contextFile,
			config,
			env: opts.env,
		});

		// 9. Log result (runPersona already appended the ledger line; surface here).
		log(`persona "${decision.persona}" finished (exit ${result.exitCode}, ok=${result.ok}).`);

		await releaseLock(workspace);
		return {
			ok: result.ok,
			action: "ran",
			decision: decision.decision,
			persona: decision.persona,
			reason: decision.reason,
			runId,
			runDir: result.runDir,
			message: `Ran persona "${decision.persona}" (${result.ok ? "ok" : "exit " + result.exitCode}).`,
		};
	} catch (err) {
		await releaseLock(workspace).catch(() => {});
		return { ok: false, action: "error", message: `Loop cycle error: ${err?.message || err}` };
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
