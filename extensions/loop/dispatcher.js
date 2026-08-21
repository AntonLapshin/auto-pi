/**
 * Dispatcher for the auto-pi loop (M6, plan.md §15).
 *
 * Given the scanned GitHub state (issues, PRs, CI, labels) and the project
 * config, decides which persona should run next — or whether the loop should
 * stop or wait. The dispatch order (plan.md §15) is evaluated top-to-bottom:
 *
 *   1. stop file exists                       → stop
 *   2. budget exceeded                        → stop
 *   3. initiation needs human                 → wait
 *
 * One-PR-at-a-time gate (while any PR is open only the PR is worked):
 *   4a. PR has changes requested               → Engineer (address comments)
 *   4b. PR approved + merge-ready              → Engineer/Merge
 *   4c. PR ready for review                    → Review Engineer
 *   4d. PR approved but not merge-ready        → Engineer (resolve/merge)
 *   4e. otherwise (any other open PR)          → Review Engineer
 *
 * No open PRs → the previous PR is merged/closed, the Engineer may pick the
 * next task; PM spawns only after all PRs are merged and no issues remain:
 *   5. open ready issues                       → Engineer
 *   6. open issues remain (unplanned/PM notes) → PM
 *   7. no open PRs and no open issues          → PM (finalize)
 *
 * The middle gate guarantees only one PR is ever in flight: a fresh Engineer
 * implementation is never dispatched while a PR is open, so the flow is
 * Engineer → Review → Engineer (address comments) → Engineer (merge) →
 * Engineer (next task) → … → PM.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { DECISION, PERSONAS, LABELS } from "./constants.js";

export { DECISION, PERSONAS, LABELS };

/**
 * Pick the oldest (lowest-number) PR from a list, or null when empty.
 *
 * Stacked PRs must be reviewed/merged in dependency order: the base PR (lowest
 * number, created first) first, then each PR stacked on top of it. `gh pr list`
 * returns PRs newest-first, so callers must not rely on array order — sort by
 * number ascending and take the first.
 *
 * @param {Array<{number: number}>} prs
 * @returns {object|null} the lowest-numbered PR, or null when the list is empty
 */
function pickOldest(prs) {
	if (!prs || prs.length === 0) return null;
	return [...prs].sort((a, b) => a.number - b.number)[0];
}

/**
 * True when a PR is approved. Approval is recorded via the `pi:approved` label
 * (the Review Engineer applies it because the auto-pi token is the PR author
 * and GitHub forbids self-approval, so the GitHub `reviewDecision` stays empty).
 * We accept either the `pi:approved` label or an `approved` GitHub review
 * decision.
 *
 * @param {{labels?: string[], review?: string}} p
 * @returns {boolean}
 */
function isApproved(p) {
	return p?.review === "approved" || (p?.labels || []).includes(LABELS.APPROVED);
}

/**
 * Decide the next action for the loop.
 *
 * @param {object} inputs
 * @param {boolean} inputs.stopped          stop file present this cycle
 * @param {object} inputs.budget            { exceeded, reason } from budgetExceeded
 * @param {boolean} inputs.needsHuman       initiation/state requires a human
 * @param {object} inputs.state             scanned GitHub state ({ issues, prs, ... })
 * @param {object} [inputs.config]          parsed .pi/config.json (used for hints)
 * @returns {{ decision: string, persona?: string, reason: string }}
 */
export function dispatch(inputs) {
	const { stopped, budget, needsHuman, state, config } = inputs;
	const budgetInfo = budget || { exceeded: false, reason: "" };
	const issues = state?.issues || [];
	const prs = state?.prs || [];

	// 1. Stop file → stop.
	if (stopped) {
		return { decision: DECISION.STOP, reason: "stop file present" };
	}

	// 2. Budget exceeded → stop.
	if (budgetInfo.exceeded) {
		return { decision: DECISION.STOP, reason: budgetInfo.reason || "budget exceeded" };
	}

	// 3. Initiation needs human → wait.
	if (needsHuman) {
		return { decision: DECISION.WAIT, reason: "a human decision is required (pi:needs-human)" };
	}

	// Helper predicates over the scanned state.
	const hasLabel = (labels, label) => labels.includes(label);
	const issueWithLabel = (label) => issues.find((i) => hasLabel(i.labels, label));

	// ------------------------------------------------------------------
	// One-PR-at-a-time gate: while ANY PR is open, the loop only works the
	// existing PR (review → address comments → merge). It never starts a new
	// implementation, so only one PR is ever in flight at a time and PM is
	// never dispatched mid-stream.
	// ------------------------------------------------------------------
	if (prs.length > 0) {
		// 4a. PR has changes requested → Engineer (address review comments).
		const changesRequested = prs.find((p) => p.review === "changes_requested");
		if (changesRequested) {
			return {
				decision: DECISION.ENGINEER,
				persona: PERSONAS.ENGINEER,
				reason: `PR #${changesRequested.number} has changes requested`,
			};
		}

		// 4b. PR approved + merge-ready → Engineer (squash-merge).
		//
		// Approval is recorded via the `pi:approved` label, because the auto-pi
		// token is the PR author and GitHub forbids self-approval — so the GitHub
		// `reviewDecision` stays empty even after the Review Engineer approves. We
		// treat the `pi:approved` label OR an `approved` review decision as the
		// approval signal.
		const approvedMerge = pickOldest(
			prs.filter(
				(p) => isApproved(p) && (p.mergeable || hasLabel(p.labels, LABELS.MERGE_READY)),
			),
		);
		if (approvedMerge) {
			return {
				decision: DECISION.ENGINEER_MERGE,
				persona: PERSONAS.ENGINEER,
				reason: `PR #${approvedMerge.number} approved and merge-ready`,
			};
		}

		// 4c. PR ready for review → Review Engineer. The Engineer marks a
		// freshly-opened PR with `pi:review-needed`; `pi:review-requested` and a
		// `review_requested` decision also count. (This mirrors the Review
		// context packer's own resolveReviewTarget so the labels agree.)
		//
		// Stacked-PR ordering: when several PRs are awaiting review at once, pick
		// the OLDEST (lowest-number) one. `gh pr list` returns PRs newest-first,
		// so a bare `find` would review the newest/middle PR while never touching
		// the base PR everything is stacked on — the base must be reviewed and
		// merged first or the stacked PRs can never merge. Lowest number == base
		// for the normal create-PR-per-issue flow.
		const readyForReview = pickOldest(
			prs.filter(
				(p) =>
					hasLabel(p.labels, LABELS.REVIEW_NEEDED) ||
					hasLabel(p.labels, LABELS.REVIEW_REQUESTED) ||
					p.review === "review_requested",
			),
		);
		if (readyForReview) {
			return {
				decision: DECISION.REVIEW,
				persona: PERSONAS.REVIEW,
				reason: `PR #${readyForReview.number} ready for review`,
			};
		}

		// 4d. An approved PR that is not yet merge-ready (e.g. a conflict) →
		//    Engineer, so it can resolve the conflict and merge it rather than
		//    being bounced back to review. Prefer the oldest/base PR so the
		//    dependency chain merges in order.
		const approvedPending = pickOldest(prs.filter((p) => isApproved(p)));
		if (approvedPending) {
			return {
				decision: DECISION.ENGINEER_MERGE,
				persona: PERSONAS.ENGINEER,
				reason: `PR #${approvedPending.number} approved but not merge-ready (${approvedPending.mergeable ? "merge-ready label" : "conflict/blocked"}) — engineer to resolve and merge`,
			};
		}

		// 4e. An open PR with no review decision yet (or otherwise unlabeled) →
		//    Review it. Keeps the loop progressing the single open PR and blocks
		//    starting new implementation work until the previous PR is resolved.
		const openPr = pickOldest(prs);
		return {
			decision: DECISION.REVIEW,
			persona: PERSONAS.REVIEW,
			reason: `PR #${openPr.number} open (review: ${openPr.review}) — review before starting new work`,
		};
	}

	// ------------------------------------------------------------------
	// No open PRs → the previous PR is merged/closed. The Engineer picks the
	// next task; PM spawns only once all PRs are merged and no issues remain.
	// ------------------------------------------------------------------

	// 5. Open ready issues → Engineer (implements one; Engineer's judgement
	//    decides which task to pick among the ready issues).
	if (issueWithLabel(LABELS.READY)) {
		return {
			decision: DECISION.ENGINEER,
			persona: PERSONAS.ENGINEER,
			reason: "an open issue is ready to implement",
		};
	}

	// 6. Open issues remain (unplanned / unresolved PM notes) → PM, so the
	//    work can be split/planned into `pi:ready` issues the Engineer can pick
	//    up next.
	if (issues.length > 0) {
		const hasPmNote = Boolean(issueWithLabel(LABELS.PM_NOTE));
		return {
			decision: DECISION.PM,
			persona: PERSONAS.PM,
			reason: hasPmNote
				? "an open issue has unresolved PM notes"
				: `${issues.length} open issue(s) remain unplanned`,
		};
	}

	// 7. No open PRs and no open issues → PM (finalize / plan the next slice).
	return { decision: DECISION.PM, persona: PERSONAS.PM, reason: "no open issues or PRs; PM to finalize" };
}
