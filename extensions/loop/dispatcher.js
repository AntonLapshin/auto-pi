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
		const approvedMerge = prs.find(
			(p) => p.review === "approved" && (p.mergeable || hasLabel(p.labels, LABELS.MERGE_READY)),
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
		const readyForReview = prs.find(
			(p) =>
				hasLabel(p.labels, LABELS.REVIEW_NEEDED) ||
				hasLabel(p.labels, LABELS.REVIEW_REQUESTED) ||
				p.review === "review_requested",
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
		//    being bounced back to review.
		const approvedPending = prs.find((p) => p.review === "approved");
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
		const openPr = prs[0];
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
