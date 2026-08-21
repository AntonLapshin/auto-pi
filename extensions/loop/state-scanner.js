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
import { RUNS_LEDGER_REL, LABELS } from "./constants.js";
import { readUsage, estimateCost } from "../../skills/logging/core.js";

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
 * Classify PR review state from the reviewDecision / requested reviewers and the
 * auto-pi labels.
 *
 * The auto-pi token is the PR author, so GitHub forbids self-review and the
 * native `reviewDecision` stays empty even after the Review Engineer records a
 * decision. Decisions are therefore also recorded via the auto-pi labels:
 * `pi:changes-requested` / `pi:approved` / (`pi:review-needed` + `pi:review-requested`).
 *
 * Treat those labels as the review state so the dispatcher can route a decided
 * PR back to the Engineer (changes requested → address comments) or to merge
 * (approved) instead of re-reviewing a decided PR forever. The labels take
 * precedence over the native decision because they are the authoritative signal
 * when the native decision is empty (self-review blocked).
 *
 * Returns one of: "changes_requested", "approved", "review_requested", "none".
 */
function classifyReview(reviewDecision, requestedReviewers = [], labels = []) {
	const has = (lbl) => Array.isArray(labels) && labels.includes(lbl);
	if (has(LABELS.CHANGES_REQUESTED)) return "changes_requested";
	if (has(LABELS.APPROVED)) return "approved";
	if (has(LABELS.REVIEW_REQUESTED) || has(LABELS.REVIEW_NEEDED)) return "review_requested";

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
	const prs = parseJsonArray(prsRes.stdout).map((p) => {
		const labels = labelNames(p.labels);
		return {
			number: p.number,
			title: p.title,
			headRefName: p.headRefName,
			baseRefName: p.baseRefName,
			url: p.url,
			labels,
			review: classifyReview(p.reviewDecision, [], labels),
			mergeable: p.mergeable === "MERGEABLE",
			createdAt: p.createdAt,
			updatedAt: p.updatedAt,
		};
	});

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
 * Read budget usage from the local run ledger + token-usage accumulation
 * (plan.md §10, M10). The run ledger (`runs.jsonl`) carries the plan.md §20.1
 * run records with `tokensInput`/`tokensOutput`/`tokensTotal`; the usage
 * ledger (`usage.jsonl`) holds per-day/per-cycle accumulation. Sums the most
 * recent available source (falls back to the run ledger when usage.jsonl is
 * absent, e.g. older workspaces).
 *
 * @param {string} workspace  absolute path to the project root
 * @returns {Promise<{ tokensUsed: number, costUsd: number, runs: number }>}
 */
export async function readBudgetUsage(workspace) {
	// Prefer the per-day accumulation ledger (M10) for accurate per-day totals.
	// Only use it when it actually has data; otherwise fall back to the run
	// ledger (which also preserves backward compatibility with older workspaces
	// and the legacy `tokensUsed`/`costUsd` record shape).
	try {
		const usage = await readUsage(workspace);
		const today = new Date().toISOString().slice(0, 10);
		const todayUsage = usage.byDay?.[today] || usage.totals;
		const tokensUsed = Number(todayUsage.tokensTotal) || 0;
		const runs = Number(todayUsage.runs) || 0;
		if (runs > 0) {
			const costUsd = estimateCost(tokensUsed);
			return { tokensUsed, costUsd, runs };
		}
	} catch {
		// fall through to the run-ledger scan below
	}

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
				tokensUsed += Number(entry.tokensUsed || entry.tokensTotal || entry.tokens_total || 0) || 0;
				costUsd += Number(entry.costUsd || entry.cost_usd || 0) || 0;
			} catch {
				// skip malformed lines
			}
		}
	} catch {
		// no ledger yet — zero usage
	}
	if (!costUsd) costUsd = estimateCost(tokensUsed);
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
