/**
 * Status core for the auto-pi harness (M13, plan.md §3.3).
 *
 * Builds the `/loop-status` report: active project, loop status, last persona run,
 * open issues/PRs, and budget usage. Shared between the interactive `/loop-status`
 * command (`extensions/harness.ts`) and the fallback CLI (`scripts/status.js`).
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readActiveProject } from "../../extensions/loop/orchestrator.js";
import { readBudgetUsage } from "../../extensions/loop/state-scanner.js";
import { readRuns, readErrors, readUsage, estimateCost } from "../logging/core.js";
import { budgetLimits } from "../budget-guard/core.js";
import { LOOP_LOCK_REL, STOP_FILE_REL } from "../../extensions/loop/constants.js";

/**
 * Read the loop lock file (best-effort).
 * @param {string} workspace
 * @returns {Promise<{ running: boolean, pid?: number, startedAt?: string }>}
 */
async function readLoopState(workspace) {
	try {
		const raw = await readFile(join(workspace, LOOP_LOCK_REL), "utf8");
		const data = JSON.parse(raw);
		const pid = Number(data.pid);
		if (pid > 0 && isProcessAlive(pid)) {
			return { running: true, pid, startedAt: data.startedAt };
		}
		return { running: false, pid, startedAt: data.startedAt };
	} catch {
		return { running: false };
	}
}

/** True when a process with the given PID is alive on this machine. */
function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code === "EPERM";
	}
}

/**
 * Build the full status report for the active project.
 *
 * @param {object} [opts]
 * @param {string} [opts.currentProjectFile] override for tests
 * @param {Function} [opts.gh] injected gh runner (for open issues/PRs; optional)
 * @returns {Promise<{ ok: boolean, report?: string, error?: string }>}
 */
export async function buildStatus(opts = {}) {
	const activeRes = await readActiveProject(opts.currentProjectFile);
	if (!activeRes.ok) {
		return { ok: false, error: activeRes.error };
	}
	const active = activeRes.active;
	const workspace = active.workspace;
	const lines = [];

	// Project identity.
	const project = active.projectName || "";
	const repo = active.repo || "";
	lines.push(`# auto-pi status`);
	lines.push(``);
	lines.push(`- **Project:** ${project || "(unnamed)"}`);
	lines.push(`- **Repo:** ${repo || "(none)"}`);
	lines.push(`- **Workspace:** ${workspace}`);
	lines.push(`- **Started:** ${active.startedAt || "unknown"}`);
	lines.push(``);

	// Loop status.
	const loop = await readLoopState(workspace);
	const stopped = existsSync(join(workspace, STOP_FILE_REL));
	if (loop.running) {
		lines.push(`- **Loop:** running (PID ${loop.pid})${loop.startedAt ? ` since ${loop.startedAt}` : ""}`);
	} else if (stopped) {
		lines.push(`- **Loop:** stopped (stop file present)`);
	} else {
		lines.push(`- **Loop:** not running`);
	}
	lines.push(``);

	// Config (budget limits).
	let config = {};
	try {
		const raw = await readFile(join(workspace, ".pi", "config.json"), "utf8");
		config = JSON.parse(raw);
	} catch {
		// no config — leave empty
	}
	const limits = budgetLimits(config);

	// Budget usage.
	const usage = await readBudgetUsage(workspace);
	const usageLedger = await readUsage(workspace);
	const today = new Date().toISOString().slice(0, 10);
	const todayUsage = usageLedger.byDay?.[today] || usageLedger.totals || { tokensTotal: 0 };
	const costUsd = estimateCost(Number(todayUsage.tokensTotal), config);
	const fmtLimit = (n) => (n > 0 ? n.toLocaleString() : "unlimited");

	lines.push(`## Budget`);
	lines.push(``);
	lines.push(`- Tokens used today: ${String(Number(todayUsage.tokensTotal) || 0).toLocaleString()} / ${fmtLimit(limits.maxTokensPerDay)}`);
	lines.push(`- Estimated cost today: $${costUsd.toFixed(4)} / $${limits.maxCostPerDayUsd}`);
	lines.push(`- Cycle budget: ${fmtLimit(limits.maxTokensPerCycle)} tokens/cycle`);
	lines.push(``);

	// Last persona run.
	const runs = await readRuns(workspace);
	const last = runs.length ? runs[runs.length - 1] : null;
	lines.push(`## Last persona run`);
	lines.push(``);
	if (last) {
		lines.push(`- Persona: **${last.persona || "unknown"}**`);
		lines.push(`- Status: **${last.status || last.action || "unknown"}**`);
		lines.push(`- Action: ${last.action || ""}`);
		lines.push(`- Reason: ${last.reason || ""}`);
		lines.push(`- Started: ${last.startedAt || ""}`);
		lines.push(`- Tokens: ${String(Number(last.tokensTotal) || 0).toLocaleString()}`);
	} else {
		lines.push(`No persona runs recorded yet.`);
	}
	lines.push(``);

	// Recent errors.
	const errors = await readErrors(workspace);
	if (errors.length) {
		lines.push(`## Recent errors (${errors.length})`);
		lines.push(``);
		for (const e of errors.slice(-5)) {
			lines.push(`- ${e.at || ""} ${e.persona ? `[${e.persona}] ` : ""}${String(e.error || "").slice(0, 200)}`);
		}
		lines.push(``);
	}

	// Open issues/PRs (best-effort; only when a gh runner is available).
	if (opts.gh && repo.includes("/")) {
		const [owner, name] = repo.split("/");
		try {
			const issuesRes = await opts.gh(["issue", "list", "--repo", repo, "--state", "open", "--json", "number,title,labels"]);
			const prsRes = await opts.gh(["pr", "list", "--repo", repo, "--state", "open", "--json", "number,title,labels"]);
			const parse = (stdout) => {
				try {
					const arr = JSON.parse(stdout || "[]");
					return Array.isArray(arr) ? arr : [];
				} catch {
					return [];
				}
			};
			const issues = parse(issuesRes.stdout);
			const prs = parse(prsRes.stdout);
			lines.push(`## GitHub`);
			lines.push(``);
			lines.push(`- **Open issues:** ${issues.length}`);
			for (const i of issues.slice(0, 10)) {
				lines.push(`  - #${i.number} ${i.title} [${(i.labels || []).map((l) => l?.name || l).join(", ") || "no labels"}]`);
			}
			lines.push(`- **Open PRs:** ${prs.length}`);
			for (const p of prs.slice(0, 10)) {
				lines.push(`  - #${p.number} ${p.title} [${(p.labels || []).map((l) => l?.name || l).join(", ") || "no labels"}]`);
			}
			lines.push(``);
		} catch {
			lines.push(`## GitHub`, ``);
			lines.push(`(Could not query GitHub — is gh authenticated?)`, ``);
		}
	}

	return { ok: true, report: lines.join("\n") };
}
