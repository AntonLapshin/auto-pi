/**
 * Loop reliability helpers for the auto-pi harness (M13, plan.md §28 hardening).
 *
 * Implements the hardening measures that keep the loop alive in the face of
 * real-world GitHub/network failures and prevent it from spinning forever:
 *
 *   - **Stale branch cleanup** — close/delete obsolete feature branches whose
 *     PR was merged (or abandoned) so the repo stays tidy and the Engineer
 *     doesn't re-use a stale `task/{issueNum}-*` branch.
 *   - **Failed-issue limits** — cap repeated attempts per issue
 *     (`limits.maxIssueAttempts`, default 3). An issue that keeps failing to
 *     implement is labelled `pi:blocked` + `pi:needs-human` instead of being
 *     retried forever.
 *   - **Conflict handling** — detect merge conflicts on open PRs and label them
 *     `pi:conflict` so the dispatcher routes the Engineer to resolve them.
 *
 * GitHub access is injected as a `gh(args, opts)` async function (same shape as
 * the helpers elsewhere) so the logic is fully testable with a fake.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { LABELS } from "./constants.js";

/**
 * Close/delete stale feature branches whose PR has been merged (or abandoned).
 *
 * Scans merged PRs and deletes their head branches if they still exist remotely.
 * Also closes any open PR whose head branch name matches a `task/{issueNum}-*`
 * pattern for an issue that is already closed (abandoned work) — but only the
 * branch cleanup for merged PRs is automatic; closing abandoned PRs is left to
 * the personas via the normal review/merge flow unless `forceClose` is set.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} ghFn injected gh runner
 * @param {object} [opts] { limit? }
 * @returns {Promise<{ ok: boolean, deleted: string[], error?: string }>}
 */
export async function cleanupStaleBranches(owner, repo, ghFn, opts = {}) {
	const fullName = `${owner}/${repo}`;
	const limit = Number(opts.limit) || 10;
	const deleted = [];

	// 1. Merged PRs — delete their head branches if they still exist.
	const mergedRes = await ghFn([
		"pr", "list", "--repo", fullName, "--state", "merged",
		"--limit", String(limit),
		"--json", "number,headRefName,mergedAt",
	]);
	if (!mergedRes.ok) {
		return { ok: false, deleted, error: mergedRes.stderr?.trim() || "gh pr list (merged) failed" };
	}
	let merged = [];
	try {
		merged = JSON.parse(mergedRes.stdout || "[]");
	} catch {
		merged = [];
	}
	if (!Array.isArray(merged)) merged = [];

	for (const pr of merged) {
		const head = pr?.headRefName;
		if (!head || head === "main" || head === "master") continue;
		const del = await ghFn(["api", `repos/${fullName}/git/refs/heads/${head}`, "--method", "DELETE"]);
		if (del.ok || del.exitCode === 0) {
			deleted.push(`#${pr.number}:${head}`);
		} else {
			// 404 → branch already gone; anything else → leave it (best-effort).
			const msg = String(del.stderr || "");
			if (!/404|not found/i.test(msg)) {
				// Non-404 failure — not fatal, just note it.
				deleted.push(`#${pr.number}:${head} (cleanup skipped: ${msg.slice(0, 80)})`);
			}
		}
	}

	return { ok: true, deleted };
}

/**
 * Detect merge conflicts on open PRs and label them `pi:conflict`.
 * Returns the PRs that were (newly) labelled.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} ghFn injected gh runner
 * @returns {Promise<{ ok: boolean, conflicted: number[], error?: string }>}
 */
export async function detectAndLabelConflicts(owner, repo, ghFn) {
	const fullName = `${owner}/${repo}`;
	const prsRes = await ghFn([
		"pr", "list", "--repo", fullName, "--state", "open",
		"--json", "number,mergeable,labels,headRefName",
	]);
	if (!prsRes.ok) {
		return { ok: false, conflicted: [], error: prsRes.stderr?.trim() || "gh pr list failed" };
	}
	let prs = [];
	try {
		prs = JSON.parse(prsRes.stdout || "[]");
	} catch {
		prs = [];
	}
	if (!Array.isArray(prs)) prs = [];

	const conflicted = [];
	for (const p of prs) {
		if (p?.mergeable !== "CONFLICTING") continue;
		const labels = Array.isArray(p.labels)
			? p.labels.map((l) => (typeof l === "string" ? l : l?.name || "")).filter(Boolean)
			: [];
		if (labels.includes(LABELS.CONFLICT)) continue; // already labelled
		const edit = await ghFn(["pr", "edit", String(p.number), "--repo", fullName, "--add-label", LABELS.CONFLICT]);
		if (edit.ok || edit.exitCode === 0) conflicted.push(p.number);
	}
	return { ok: true, conflicted };
}

/**
 * Count how many times an issue has been attempted (i.e. how many PRs have
 * referenced it and been closed without merging, or how many failed runs
 * targeted it). Uses the local run ledger when available; falls back to
 * scanning GitHub PRs referencing the issue.
 *
 * @param {string} workspace absolute project root (for the run ledger)
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {Function} ghFn injected gh runner
 * @returns {Promise<number>} attempt count
 */
export async function countIssueAttempts(workspace, owner, repo, issueNumber, ghFn) {
	// 1. Count failed persona runs that targeted this issue from the local
	//    ledger (runs.jsonl), if it exists.
	try {
		const { readRuns } = await import("../../skills/logging/core.js");
		const runs = await readRuns(workspace);
		let count = 0;
		for (const r of runs) {
			// A failed run that mentioned this issue in its error/reason counts.
			const text = `${r.error || ""} ${r.reason || ""} ${r.repo || ""}`;
			if (r.status === "error" && new RegExp(`#${issueNumber}\\b`).test(text)) count += 1;
		}
		if (count > 0) return count;
	} catch {
		// fall through to GitHub scan
	}

	// 2. Fallback: count closed PRs that referenced the issue (closes/fixes #N).
	const fullName = `${owner}/${repo}`;
	const res = await ghFn([
		"pr", "list", "--repo", fullName, "--state", "all",
		"--limit", "100",
		"--json", "number,title,body,state",
	]);
	if (!res.ok) return 0;
	let prs = [];
	try {
		prs = JSON.parse(res.stdout || "[]");
	} catch {
		prs = [];
	}
	if (!Array.isArray(prs)) prs = [];
	return prs.filter((p) => {
		const body = String(p?.body || "");
		return new RegExp(`(?:closes|fixes|resolves)\\s+#${issueNumber}\\b`, "i").test(body);
	}).length;
}

/**
 * Check whether an issue has exceeded its attempt limit and, if so, label it
 * `pi:blocked` + `pi:needs-human` so the loop stops retrying it (plan.md §21 /
 * M13 `limits.maxIssueAttempts`, default 3).
 *
 * @param {object} p
 * @param {string} p.workspace
 * @param {string} p.owner
 * @param {string} p.repo
 * @param {number} p.issueNumber
 * @param {object} p.config parsed config (limits.maxIssueAttempts)
 * @param {Function} p.ghFn injected gh runner
 * @returns {Promise<{ ok: boolean, exceeded: boolean, attempts: number, max: number, action?: string }>}
 */
export async function enforceIssueAttemptLimit({ workspace, owner, repo, issueNumber, config, ghFn }) {
	const max = Number(config?.limits?.maxIssueAttempts) || 3;
	const attempts = await countIssueAttempts(workspace, owner, repo, issueNumber, ghFn);
	if (attempts < max) {
		return { ok: true, exceeded: false, attempts, max };
	}

	// Exceeded — label blocked + needs-human (idempotent).
	const fullName = `${owner}/${repo}`;
	const edit = await ghFn([
		"issue", "edit", String(issueNumber), "--repo", fullName,
		"--add-label", `${LABELS.BLOCKED},${LABELS.NEEDS_HUMAN}`,
	]);
	return {
		ok: edit.ok || edit.exitCode === 0,
		exceeded: true,
		attempts,
		max,
		action: `issue #${issueNumber} exceeded ${max} attempts — labelled ${LABELS.BLOCKED} + ${LABELS.NEEDS_HUMAN}`,
	};
}

/**
 * Run all reliability checks for a loop cycle (best-effort, never throws):
 * stale branch cleanup + conflict labelling + issue-attempt-limit enforcement.
 * Returns a short summary of actions.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Function} ghFn injected gh runner
 * @param {object} [io] { log }
 * @param {object} [opts] { workspace?, config?, state? } — when provided,
 *   ready issues are checked against `limits.maxIssueAttempts` and labelled
 *   `pi:blocked` + `pi:needs-human` once exceeded (M13).
 * @returns {Promise<{ ok: boolean, actions: string[] }>}
 */
export async function runReliabilityChecks(owner, repo, ghFn, io = {}, opts = {}) {
	const log = io.log || (() => {});
	const actions = [];
	try {
		const stale = await cleanupStaleBranches(owner, repo, ghFn);
		if (stale.ok && stale.deleted.length) {
			log(`stale branch cleanup: deleted ${stale.deleted.join(", ")}`);
			actions.push(`deleted ${stale.deleted.length} stale branch(es)`);
		}
	} catch (err) {
		log(`stale branch cleanup skipped: ${err?.message || err}`);
	}
	try {
		const conflicts = await detectAndLabelConflicts(owner, repo, ghFn);
		if (conflicts.ok && conflicts.conflicted.length) {
			log(`conflict detection: labelled PR(s) ${conflicts.conflicted.join(", ")} as ${LABELS.CONFLICT}`);
			actions.push(`labelled ${conflicts.conflicted.length} conflicting PR(s)`);
		}
	} catch (err) {
		log(`conflict detection skipped: ${err?.message || err}`);
	}
	// M13: enforce the per-issue attempt limit on ready issues. An issue that
	// keeps failing to implement is labelled `pi:blocked` + `pi:needs-human`
	// instead of being retried forever (limits.maxIssueAttempts, default 3).
	if (opts.workspace && opts.config && Array.isArray(opts.state?.issues)) {
		const ready = opts.state.issues.filter((i) =>
			Array.isArray(i.labels) &&
			(i.labels.includes(LABELS.READY) || i.labels.includes(LABELS.PM_NOTE)) &&
			!i.labels.includes(LABELS.BLOCKED) &&
			!i.labels.includes(LABELS.NEEDS_HUMAN),
		);
		for (const issue of ready) {
			try {
				const res = await enforceIssueAttemptLimit({
					workspace: opts.workspace,
					owner,
					repo,
					issueNumber: issue.number,
					config: opts.config,
					ghFn,
				});
				if (res.exceeded && res.action) {
					log(res.action);
					actions.push(res.action);
				}
			} catch {
				// best-effort per issue
			}
		}
	}
	return { ok: true, actions };
}
