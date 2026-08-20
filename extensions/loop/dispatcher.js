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
 *   4. PR has changes requested               → Engineer
 *   5. PR approved + merge-ready              → Engineer/Merge
 *   6. PR ready for review                    → Review Engineer
 *   7. open issues with unresolved PM notes   → PM
 *   8. open ready issues                      → Engineer
 *   9. otherwise                              → PM
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
	const prWithLabel = (label) => prs.find((p) => hasLabel(p.labels, label));
	const issueWithLabel = (label) => issues.find((i) => hasLabel(i.labels, label));

	// 4. PR has changes requested → Engineer.
	const changesRequested = prs.find((p) => p.review === "changes_requested");
	if (changesRequested) {
		return {
			decision: DECISION.ENGINEER,
			persona: PERSONAS.ENGINEER,
			reason: `PR #${changesRequested.number} has changes requested`,
		};
	}

	// 5. PR approved + merge-ready → Engineer/Merge.
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

	// 6. PR ready for review → Review Engineer.
	// A PR is "ready for review" when it has the review-requested label, or
	// reviewers are requested, or it is otherwise waiting on a review.
	const readyForReview = prWithLabel(LABELS.REVIEW_REQUESTED) || prs.find((p) => p.review === "review_requested");
	if (readyForReview) {
		return {
			decision: DECISION.REVIEW,
			persona: PERSONAS.REVIEW,
			reason: `PR #${readyForReview.number} ready for review`,
		};
	}

	// 7. Open issues with unresolved PM notes → PM.
	if (issueWithLabel(LABELS.PM_NOTE)) {
		return {
			decision: DECISION.PM,
			persona: PERSONAS.PM,
			reason: "an open issue has unresolved PM notes",
		};
	}

	// 8. Open ready issues → Engineer.
	if (issueWithLabel(LABELS.READY)) {
		return {
			decision: DECISION.ENGINEER,
			persona: PERSONAS.ENGINEER,
			reason: "an open issue is ready to implement",
		};
	}

	// 9. Otherwise → PM (break down more work / plan next slice).
	const fallback = issues.length > 0
		? `no ready work; ${issues.length} open issue(s) remain unplanned`
		: "no open issues or PRs; PM to plan the next slice";
	return { decision: DECISION.PM, persona: PERSONAS.PM, reason: fallback };
}
