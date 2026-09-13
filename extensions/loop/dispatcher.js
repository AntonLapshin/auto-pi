/**
 * Dispatcher for the auto-pi loop (M6, plan.md §15).
 *
 * Given the scanned GitHub state (issues, PRs, CI, labels) and the project
 * config, decides which persona should run next — or whether the loop should
 * stop or wait. The dispatch order (plan.md §15) is evaluated top-to-bottom:
 *
 *   1. stop file exists                       → stop
 *   2. budget exceeded                        → stop
 *
 * One-PR-at-a-time gate (while any PR is open only the PR is worked):
 *   4a. PR has changes requested               → Engineer (address comments)
 *   4b. PR approved + merge-ready              → Engineer/Merge
 *   4c. PR ready for review                    → Review Engineer
 *   4d. PR approved but not merge-ready        → Engineer (resolve/merge)
 *   4e. otherwise (any other open PR)          → Review Engineer
 *
 * No open PRs → the previous PR is merged/closed. The Engineer picks the
 * next task; PM spawns only after all PRs are merged and no issues remain:
 *   5. unresolved PM work (`pi:needs-pm`/`pi:pm-note`) → PM (split/unblock)
 *   5b. owner replied (`owner-replied`)                → PM (triage + answer)
 *   6. open ready issues (excluding `pi:blocked`/`pi:needs-human`) → Engineer
 *   7. open non-human issues remain (unplanned/blocked) → PM (revisit blocked,
 *      plan unplanned, file issues for the next milestone)
 *   6b. initiation needs human                 → wait (only when NO actionable
 *      ready work AND no non-human PM work remains — a single `pi:needs-human`
 *      issue must not starve unrelated `pi:ready` issues the Engineer could
 *      implement, nor must it starve the PM from revisiting `pi:blocked`
 *      issues and filing issues for the next milestone)
 *   8. no open PRs and no open issues          → PM (finalize) — unless the
 *      project is already marked done (completed.json), in which case → WAIT
 *      so the loop polls GitHub at zero cost and only resumes work when a new
 *      issue/PR appears (deterministic, no LLM call when nothing to do).
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
 * @param {boolean} [inputs.completed]       project already marked done
 *                                          (completed.json present) — when true
 *                                          and there is no work, the loop WAITs
 *                                          (zero-cost poll) instead of spawning
 *                                          PM to finalize again.
 * @returns {{ decision: string, persona?: string, reason: string }}
 */
export function dispatch(inputs) {
	const { stopped, budget, needsHuman, state, config, completed } = inputs;
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

	// 5. Unresolved PM work → PM first. A `pi:needs-pm` / `pi:pm-note` issue
	//    (typically a scope-too-large issue the Engineer labelled for the PM to
	//    split, engineer.md Step 7) must be handled by the PM before the Engineer
	//    picks up ready work — otherwise the left-over `pi:ready` on the same
	//    issue re-dispatches the Engineer onto the oversized issue, which stalls
	//    again. (needsHuman() already exempts `pi:blocked`+`pi:needs-pm` from the
	//    human wait, so this is the counterpart that gets the PM to actually split.)
	//
	//    NOTE: a bare `pi:blocked` issue (no `pi:needs-pm`/`pi:pm-note`) is NOT
	//    routed here. needsHuman() no longer waits on a human for a bare
	//    `pi:blocked`, and routing it to the PM here (ahead of ready work) would
	//    starve the Engineer: the block often stays valid for many cycles (e.g.
	//    while its prerequisite issues are implemented), so the PM would be
	//    re-dispatched every cycle and the Engineer would never reach the ready
	//    issues that actually resolve the block. Bare `pi:blocked` issues are
	//    instead surfaced to the PM via step 7 (issues remain → PM) once no ready
	//    work is left, so the PM revisits/unblocks them without blocking progress.
	const pmWork = issues.filter((i) =>
		i.labels.includes(LABELS.PM_NOTE) || i.labels.includes(LABELS.NEEDS_PM),
	);
	if (pmWork.length > 0) {
		return {
			decision: DECISION.PM,
			persona: PERSONAS.PM,
			reason: `issue(s) #${pmWork.map((i) => i.number).join(", #")} need PM attention (split/unblock)`,
		};
	}

	// 5b. Owner replied → PM (triage + answer). An `owner-replied` issue means
	//    the owner has commented (starting with `Owner:`) and is waiting for a
	//    response. It routes to the PM ahead of ready work so a waiting human
	//    gets a fast answer, but it is one-shot — the PM removes the label
	//    once triaged (pm.md Step 1c) — so it can never starve the Engineer
	//    the way a sticky `pi:blocked` would.
	const ownerReplied = issues.filter((i) => i.labels.includes(LABELS.OWNER_REPLIED));
	if (ownerReplied.length > 0) {
		return {
			decision: DECISION.PM,
			persona: PERSONAS.PM,
			reason: `issue(s) #${ownerReplied.map((i) => i.number).join(", #")} need owner-reply triage (owner responded)`,
		};
	}

	// 6. Open ready issues → Engineer (implements one; Engineer's judgement
	//    decides which task to pick among the ready issues). Issues labelled
	//    `pi:needs-human` are NOT actionable ready work — they wait on a human
	//    — and issues labelled `pi:blocked` are NOT implementable yet (their
	//    obstacle is unresolved) — so both are excluded here. The blocked ones
	//    are surfaced to the PM via step 7 instead. Otherwise a single
	//    need-owner or blocked issue (e.g. Pages deploy) would starve every
	//    unrelated `pi:ready` issue forever, or push the Engineer onto
	//    unimplementable work.
	const actionableReady = issues.find((i) => hasLabel(i.labels, LABELS.READY) && !hasLabel(i.labels, LABELS.NEEDS_HUMAN) && !hasLabel(i.labels, LABELS.BLOCKED));
	if (actionableReady) {
		return {
			decision: DECISION.ENGINEER,
			persona: PERSONAS.ENGINEER,
			reason: "an open issue is ready to implement",
		};
	}

	// 7. Open non-human issues remain (unplanned / blocked) → PM, so blocked
	//    issues are revisited/unblocked and unplanned work is split/planned
	//    into `pi:ready` issues the Engineer can pick up next — including
	//    filing issues for the NEXT milestone when only `pi:blocked` issues
	//    are left (the block often stays valid while its prerequisites are
	//    implemented, so the PM must keep planning ahead rather than stall).
	//    Issues labelled `pi:needs-human` are excluded: they wait on a human
	//    and are handled by the 6b wait below once no PM-actionable work
	//    remains. Checking this BEFORE the human wait guarantees a single
	//    `pi:needs-human` issue (e.g. Pages deploy) never starves milestone
	//    planning while blocked/unplanned work remains.
	const pmActionable = issues.filter((i) => !hasLabel(i.labels, LABELS.NEEDS_HUMAN));
	if (pmActionable.length > 0) {
		const hasPmNote = Boolean(pmActionable.find((i) => hasLabel(i.labels, LABELS.PM_NOTE)));
		if (hasPmNote) {
			return {
				decision: DECISION.PM,
				persona: PERSONAS.PM,
				reason: "an open issue has unresolved PM notes",
			};
		}
		const blockedOnly = pmActionable.every((i) => hasLabel(i.labels, LABELS.BLOCKED));
		if (blockedOnly) {
			return {
				decision: DECISION.PM,
				persona: PERSONAS.PM,
				reason: `only blocked issue(s) #${pmActionable.map((i) => i.number).join(", #")} remain; PM to revisit/unblock and file issues for the next milestone`,
			};
		}
		return {
			decision: DECISION.PM,
			persona: PERSONAS.PM,
			reason: `${pmActionable.length} open issue(s) remain unplanned`,
		};
	}

	// 6b. Initiation needs human → wait. Reached only when no actionable PR,
	//    PM-actionable, or ready-Engineer work remains, so waiting on the human
	//    never starves implementable work or milestone planning.
	if (needsHuman) {
		return { decision: DECISION.WAIT, reason: "a human decision is required (pi:needs-human)" };
	}

	// 7. No open PRs and no open issues → PM (finalize / plan the next slice) —
	// unless the project is already marked done. When done, there is nothing for
	// the PM to finalize, so the loop WAITs at zero cost: it keeps polling GitHub
	// and only resumes work (PM plans, then Engineer implements) once a new
	// issue/PR appears. This is the deterministic gate that keeps the loop free
	// while the project is complete.
	if (completed) {
		return { decision: DECISION.WAIT, reason: "project done and no open issues or PRs; waiting for new work" };
	}
	return { decision: DECISION.PM, persona: PERSONAS.PM, reason: "no open issues or PRs; PM to finalize" };
}
