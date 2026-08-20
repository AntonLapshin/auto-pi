/**
 * GitHub state scanner for the auto-pi loop (M6, plan.md §13.1 step 5 / §15).
 *
 * Reads the current GitHub state of the active project that the dispatcher
 * needs to decide the next persona:
 *
 *   - open issues (title, body, labels, PM notes)
 *   - open PRs (state, labels, review status, CI status, mergeable)
 *   - CI status of the default branch / open PRs
 *   - budget usage (from the local run ledger, plan.md §10)
 *
 * GitHub access is injected as a `gh(args, opts)` async function (same shape as
 * the helper in `extensions/seed/core.js`) so the scanner is fully testable with
 * a fake and works identically from the interactive `/loop` command, the loop
 * orchestrator, and the fallback CLI.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNS_LEDGER_REL } from "./constants.js";

/**
 * Run a `gh` command safely. @returns {{ ok, stdout, stderr, exitCode }}
 */
async function gh(args, opts = {}) {
	const { execa } = await import("execa");
	try {
		const res = await execa("gh", args, { reject: false, timeout: 30000, ...opts });
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err?.message || err), exitCode: 1 };
	}
}

/** Parse a `gh ... --json` output array defensively. */
function parseJsonArray(stdout) {
	try {
		const parsed = JSON.parse(stdout || "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * Classify PR review state from the reviewDecision / requested reviewers.
 * Returns one of: "changes_requested", "approved", "review_requested", "none".
 */
function classifyReview(reviewDecision, requestedReviewers = []) {
	const decision = String(reviewDecision || "").toLowerCase();
	if (decision === "changes_requested") return "changes_requested";
	if (decision === "approved") return "approved";
	if (decision === "review_requested") return "review_requested";
	if (Array.isArray(requestedReviewers) && requestedReviewers.length > 0) return "review_requested";
	return "none";
}

/** Parse a comma-separated label string into an array of label names. */
function labelNames(labels) {
	if (!Array.isArray(labels)) return [];
	return labels.map((l) => (typeof l === "string" ? l : l?.name || "")).filter(Boolean);
}

/**
 * Scan the GitHub state for the active project.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} [ghFn]  injected gh runner (defaults to the real one)
 * @returns {Promise<{ ok: boolean, state?: object, error?: string }>}
 */
export async function scanGithubState(owner, repo, ghFn = gh) {
	const fullName = `${owner}/${repo}`;

	// 1. Open issues (with labels + PM notes).
	const issuesRes = await ghFn(["issue", "list", "--repo", fullName, "--state", "open", "--json",
		"number,title,body,labels,url,createdAt,updatedAt"]);
	if (!issuesRes.ok) {
		return { ok: false, error: issuesRes.stderr?.trim() || issuesRes.stdout?.trim() || "gh issue list failed" };
	}
	const issues = parseJsonArray(issuesRes.stdout).map((i) => ({
		number: i.number,
		title: i.title,
		body: i.body || "",
		url: i.url,
		labels: labelNames(i.labels),
		createdAt: i.createdAt,
		updatedAt: i.updatedAt,
	}));

	// 2. Open PRs (with labels, review decision, mergeable, CI status).
	const prsRes = await ghFn(["pr", "list", "--repo", fullName, "--state", "open", "--json",
		"number,title,headRefName,baseRefName,labels,reviewDecision,mergeable,url,createdAt,updatedAt"]);
	if (!prsRes.ok) {
		return { ok: false, error: prsRes.stderr?.trim() || prsRes.stdout?.trim() || "gh pr list failed" };
	}
	const prs = parseJsonArray(prsRes.stdout).map((p) => ({
		number: p.number,
		title: p.title,
		headRefName: p.headRefName,
		baseRefName: p.baseRefName,
		url: p.url,
		labels: labelNames(p.labels),
		review: classifyReview(p.reviewDecision),
		mergeable: p.mergeable === "MERGEABLE",
		createdAt: p.createdAt,
		updatedAt: p.updatedAt,
	}));

	// 3. CI status for the default branch (latest push build).
	const ciRes = await ghFn(["run", "list", "--repo", fullName, "--limit", "1", "--json",
		"databaseId,status,conclusion,headBranch,createdAt,displayTitle"]);
	let ci = { status: "unknown", conclusion: "unknown" };
	if (ciRes.ok) {
		const runs = parseJsonArray(ciRes.stdout);
		if (runs.length > 0) {
			ci = {
				status: runs[0].status || "unknown",
				conclusion: runs[0].conclusion || "unknown",
				headBranch: runs[0].headBranch || "",
				displayTitle: runs[0].displayTitle || "",
			};
		}
	}

	return {
		ok: true,
		state: {
			issues,
			prs,
			ci,
			owner,
			repo,
			fullName,
			scannedAt: new Date().toISOString(),
		},
	};
}

/**
 * Read budget usage from the local run ledger (plan.md §10). The ledger is a
 * JSONL file with one line per persona invocation; each line carries token /
 * cost accounting when the persona runner reports it (M10 fills these in fully;
 * M6 reads whatever is present and defaults to zero).
 *
 * @param {string} workspace  absolute path to the project root
 * @returns {Promise<{ tokensUsed: number, costUsd: number, runs: number }>}
 */
export async function readBudgetUsage(workspace) {
	const ledgerPath = join(workspace, RUNS_LEDGER_REL);
	let tokensUsed = 0;
	let costUsd = 0;
	let runs = 0;
	try {
		const raw = await readFile(ledgerPath, "utf8");
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const entry = JSON.parse(trimmed);
				runs += 1;
				tokensUsed += Number(entry.tokensUsed || entry.tokens_total || 0) || 0;
				costUsd += Number(entry.costUsd || entry.cost_usd || 0) || 0;
			} catch {
				// skip malformed lines
			}
		}
	} catch {
		// no ledger yet — zero usage
	}
	return { tokensUsed, costUsd, runs };
}

/**
 * Evaluate whether the project budget has been exceeded (plan.md §15 step 2).
 *
 * @param {object} config  parsed .pi/config.json
 * @param {object} usage   { tokensUsed, costUsd, runs } from readBudgetUsage
 * @returns {{ exceeded: boolean, reason?: string }}
 */
export function budgetExceeded(config, usage) {
	const limits = config?.limits || {};
	const day = limits.maxTokensPerDay;
	const cost = limits.maxCostPerDayUsd;
	if (Number.isFinite(day) && day > 0 && usage.tokensUsed >= day) {
		return { exceeded: true, reason: `token budget exceeded (${usage.tokensUsed} >= ${day} tokens/day)` };
	}
	if (Number.isFinite(cost) && cost > 0 && usage.costUsd >= cost) {
		return { exceeded: true, reason: `cost budget exceeded ($${usage.costUsd.toFixed(2)} >= $${cost}/day)` };
	}
	return { exceeded: false };
}

/** Re-exported default gh runner for tests / other modules. */
export { gh as defaultGh };
