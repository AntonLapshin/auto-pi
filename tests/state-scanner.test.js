/**
 * State scanner tests (M6, plan.md §13.1 / §15).
 *
 * The scanner is the source of truth for the `review` field the dispatcher and
 * the Engineer/Review context packers consume. Because the auto-pi token is the
 * PR author, GitHub forbids self-approval/review and the native `reviewDecision`
 * stays empty — the Review Engineer records its decision via the auto-pi labels
 * (`pi:changes-requested` / `pi:approved`). The scanner must map those labels
 * into `review` so the loop routes the PR back to the Engineer instead of
 * re-reviewing a decided PR forever.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scanGithubState } from "../extensions/loop/state-scanner.js";

/**
 * Fake gh runner that returns canned open PRs — the shape `gh pr list --json`
 * returns. `reviewDecision` is empty because the author cannot self-review.
 */
function makeGh(prs) {
	return async function ghost(args) {
		if (args[0] === "issue") {
			return { ok: true, stdout: "[]", stderr: "", exitCode: 0 };
		}
		if (args[0] === "pr") {
			return { ok: true, stdout: JSON.stringify(prs), stderr: "", exitCode: 0 };
		}
		if (args[0] === "run") {
			return {
				ok: true,
				stdout: JSON.stringify([{ status: "completed", conclusion: "success" }]),
				stderr: "",
				exitCode: 0,
			};
		}
		return { ok: false, stdout: "", stderr: "unexpected: " + args.join(" "), exitCode: 1 };
	};
}

function pr(number, labels, reviewDecision = "") {
	return {
		number,
		title: `PR ${number}`,
		headRefName: `task/${number}`,
		baseRefName: "main",
		labels: labels.map((name) => ({ name })),
		reviewDecision,
		mergeable: "CONFLICTING",
		url: `https://github.com/o/r/pull/${number}`,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
	};
}

test("scanGithubState: pi:changes-requested label maps to changes_requested (self-review blocked)", async () => {
	const res = await scanGithubState("o", "r", makeGh([pr(19, ["pi:changes-requested"])]));
	assert.equal(res.ok, true);
	assert.equal(res.state.prs[0].review, "changes_requested");
});

test("scanGithubState: pi:approved label maps to approved (self-approval blocked)", async () => {
	const res = await scanGithubState("o", "r", makeGh([pr(4, ["pi:approved", "pi:merge-ready"])]));
	assert.equal(res.ok, true);
	assert.equal(res.state.prs[0].review, "approved");
});

test("scanGithubState: pi:review-needed / pi:review-requested map to review_requested", async () => {
	const needed = await scanGithubState("o", "r", makeGh([pr(3, ["pi:review-needed"])]));
	assert.equal(needed.state.prs[0].review, "review_requested");
	const requested = await scanGithubState("o", "r", makeGh([pr(3, ["pi:review-requested"])]));
	assert.equal(requested.state.prs[0].review, "review_requested");
});

test("scanGithubState: native reviewDecision still honored when present", async () => {
	const approved = await scanGithubState(
		"o",
		"r",
		makeGh([pr(5, [], "APPROVED")]),
	);
	assert.equal(approved.state.prs[0].review, "approved");

	const changes = await scanGithubState(
		"o",
		"r",
		makeGh([pr(5, [], "CHANGES_REQUESTED")]),
	);
	assert.equal(changes.state.prs[0].review, "changes_requested");
});

test("scanGithubState: no labels and no decision → none", async () => {
	const res = await scanGithubState("o", "r", makeGh([pr(6, [])]));
	assert.equal(res.state.prs[0].review, "none");
});
