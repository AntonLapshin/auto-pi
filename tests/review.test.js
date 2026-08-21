/**
 * M9 Review Engineer persona tests.
 *
 * Covers the Review Engineer context packer (plan.md §21.1): target PR
 * resolution, PR body + diff summary, linked issue + acceptance criteria,
 * review settings (reviewerCanPushTestCommits), policy excerpts, and the
 * review constants (comment format, allowed reasons, missing-test cases).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildReviewContext,
	resolveReviewTarget,
	fetchPrDetail,
	fetchPrDiffSummary,
	fetchIssueDetail,
	linkedIssueNumber,
	acceptanceCriteria,
	readPolicyExcerpts,
} from "../extensions/loop/review-context.js";
import { prepareRun, newRunId } from "../extensions/loop/persona-runner.js";
import {
	REVIEW_COMMENT_RE,
	REVIEW_REASONS,
	REVIEW_SEVERITIES,
	REVIEW_COMMANDS,
	MISSING_TEST_CASES,
	REVIEWER_CAN_PUSH_TEST_COMMITS_DEFAULT,
	LABELS,
} from "../extensions/loop/constants.js";

/** Build a minimal scanned state. */
function state(issues = [], prs = []) {
	return {
		issues,
		prs,
		ci: { status: "completed", conclusion: "success" },
		fullName: "octocat/repo",
		scannedAt: new Date().toISOString(),
	};
}

const issue = (number, labels = [], body = "") => ({ number, title: `Issue ${number}`, body, labels });
const pr = (number, labels = [], review = "none", mergeable = false) => ({
	number,
	title: `PR ${number}`,
	labels,
	review,
	mergeable,
});

/** Build a workspace with the standard project files. */
async function makeWorkspace(files = {}) {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-review-"));
	const defaults = {
		"manifest.md": "# App — Manifest\n\n## Goals\n- Deliver a slice.\n",
		"project-state.md": "# App — Project State\n\n## Status\n**Scaffolded**\n",
		"CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n### Added\n- Scaffold.\n",
	};
	for (const [rel, content] of Object.entries({ ...defaults, ...files })) {
		const full = join(dir, rel);
		await mkdir(join(dir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
		await writeFile(full, content, "utf8");
	}
	return dir;
}

/** Fake gh runner that answers PR view, PR files, issue view. */
function fakeGh({ prDetail, prFiles = [], issueDetail } = {}) {
	return async (args) => {
		const [cmd, ...rest] = args;
		if (cmd === "pr" && rest[0] === "view") {
			const body = prDetail || {
				number: Number(rest[rest.indexOf("--json") - 1]) || 1,
				title: "Add note search",
				body: "## Summary\n\nAdd search.\n\nCloses #1\n\n<!-- pi:pr issue=1 -->\n",
				headRefName: "task/1-note-search",
				baseRefName: "main",
				labels: [{ name: "pi:review-needed" }],
				mergeable: "MERGEABLE",
				reviewDecision: "REVIEW_REQUESTED",
				url: "https://github.com/octocat/repo/pull/1",
				createdAt: "t",
				updatedAt: "t",
			};
			return { ok: true, stdout: JSON.stringify(body), stderr: "", exitCode: 0 };
		}
		if (cmd === "api" && rest[0]?.includes("/pulls/") && rest[0]?.endsWith("/files")) {
			return { ok: true, stdout: JSON.stringify(prFiles), stderr: "", exitCode: 0 };
		}
		if (cmd === "issue" && rest[0] === "view") {
			const body = issueDetail || {
				number: Number(rest[rest.indexOf("--json") - 1]) || 1,
				title: "Add note search",
				body: "## Goal\n\nAdd search.\n\n## Acceptance criteria\n- [ ] search matches case-insensitively\n- [ ] empty query returns no results\n",
				state: "open",
				url: "u",
				labels: [{ name: "pi:ready" }],
			};
			return { ok: true, stdout: JSON.stringify(body), stderr: "", exitCode: 0 };
		}
		return { ok: false, stdout: "", stderr: "unexpected gh call: " + args.join(" "), exitCode: 1 };
	};
}

// --- target resolution ---

test("resolveReviewTarget picks a pi:review-needed PR", () => {
	const t = resolveReviewTarget(state([], [pr(5, ["pi:review-needed"])]));
	assert.equal(t.number, 5);
});

test("resolveReviewTarget picks the oldest/base PR among a stack (newest-first input)", () => {
	// `gh pr list` returns PRs newest-first. When several PRs are awaiting
	// review, the base (lowest-number) PR must be picked first so the stacked
	// PRs can eventually merge.
	const prs = [
		pr(6, ["pi:approved", "pi:merge-ready"]),
		pr(5, ["pi:review-needed"]),
		pr(4, ["pi:review-needed"]),
	];
	const t = resolveReviewTarget(state([], prs));
	assert.equal(t.number, 4);
});

test("resolveReviewTarget picks a review_requested PR", () => {
	const t = resolveReviewTarget(state([], [pr(3, [], "review_requested")]));
	assert.equal(t.number, 3);
});

test("resolveReviewTarget returns null with no PR awaiting review", () => {
	assert.equal(resolveReviewTarget(state([], [pr(1, [], "approved")])), null);
	assert.equal(resolveReviewTarget(state([], [])), null);
});

// --- linked issue + acceptance criteria ---

test("linkedIssueNumber parses the pi:pr marker, Closes, and bare refs", () => {
	assert.equal(linkedIssueNumber("<!-- pi:pr issue=7 -->"), 7);
	assert.equal(linkedIssueNumber("Closes #12"), 12);
	assert.equal(linkedIssueNumber("Fixes #3"), 3);
	assert.equal(linkedIssueNumber("see #9 for details"), 9);
	assert.equal(linkedIssueNumber("no link here"), null);
});

test("acceptanceCriteria extracts unchecked and checked items", () => {
	const ac = acceptanceCriteria("## Goal\n\n- [ ] search works\n- [x] done item\n- [ ] empty query ok\n");
	assert.deepEqual(ac.unchecked, ["search works", "empty query ok"]);
	assert.deepEqual(ac.checked, ["done item"]);
});

test("acceptanceCriteria returns empty arrays when no checklist", () => {
	const ac = acceptanceCriteria("## Goal\n\nJust prose.\n");
	assert.deepEqual(ac.unchecked, []);
	assert.deepEqual(ac.checked, []);
});

// --- fetch helpers ---

test("fetchPrDetail returns PR body, labels, refs, mergeable", async () => {
	const res = await fetchPrDetail("octocat", "repo", 1, fakeGh({
		prDetail: { number: 1, title: "Add search", body: "Closes #1", headRefName: "h", baseRefName: "main", labels: [{ name: "pi:review-needed" }], mergeable: "MERGEABLE", reviewDecision: "REVIEW_REQUESTED", url: "u", createdAt: "t", updatedAt: "t" },
	}));
	assert.equal(res.ok, true);
	assert.equal(res.pr.body, "Closes #1");
	assert.deepEqual(res.pr.labels, ["pi:review-needed"]);
	assert.equal(res.pr.mergeable, true);
});

test("fetchPrDiffSummary returns per-file change counts", async () => {
	const res = await fetchPrDiffSummary("octocat", "repo", 1, fakeGh({
		prFiles: [
			{ filename: "src/core/search.ts", status: "modified", additions: 12, deletions: 2, changes: 14 },
			{ filename: "tests/core/search.test.ts", status: "added", additions: 30, deletions: 0, changes: 30 },
		],
	}));
	assert.equal(res.ok, true);
	assert.equal(res.files.length, 2);
	assert.equal(res.files[0].filename, "src/core/search.ts");
	assert.equal(res.files[0].additions, 12);
});

test("fetchIssueDetail returns the linked issue body", async () => {
	const res = await fetchIssueDetail("octocat", "repo", 1, fakeGh({
		issueDetail: { number: 1, title: "Add search", body: "Goal\n- [ ] works", state: "open", url: "u", labels: [{ name: "pi:ready" }] },
	}));
	assert.equal(res.ok, true);
	assert.equal(res.issue.body, "Goal\n- [ ] works");
	assert.deepEqual(res.issue.labels, ["pi:ready"]);
});

test("readPolicyExcerpts reads only existing named policies", async () => {
	const dir = await makeWorkspace({
		"policies/testing-policy.md": "# Testing Policy\n\nEvery change adds tests.\n",
	});
	const excerpts = await readPolicyExcerpts(dir, ["testing-policy", "done-definition"]);
	assert.equal(excerpts["testing-policy"], "# Testing Policy\n\nEvery change adds tests.");
	assert.equal(excerpts["done-definition"], undefined);
});

// --- context build ---

test("buildReviewContext includes project, review settings, and target PR", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildReviewContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo", defaultBranch: "main" }, stack: { framework: "react", typescript: true, tailwind: true }, review: { reviewerCanPushTestCommits: false } },
		state: state([], [pr(1, ["pi:review-needed"], "review_requested", true)]),
		decision: { decision: "review", persona: "review-engineer", reason: "PR ready for review" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /## Project/);
	assert.match(ctx, /octocat\/repo/);
	assert.match(ctx, /## Review settings/);
	assert.match(ctx, /reviewerCanPushTestCommits: false/);
	assert.match(ctx, /## Target PR/);
	assert.match(ctx, /Review PR #1/);
	assert.match(ctx, /## Verification commands/);
	assert.match(ctx, /npm test/);
	assert.match(ctx, /test:coverage/);
});

test("buildReviewContext includes PR body, diff summary, and linked issue acceptance criteria", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildReviewContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([], [pr(1, ["pi:review-needed"])]),
		decision: { decision: "review", persona: "review-engineer", reason: "PR ready for review" },
		ghFn: fakeGh({
			prFiles: [{ filename: "src/core/search.ts", status: "modified", additions: 12, deletions: 2, changes: 14 }],
			issueDetail: { number: 1, title: "Add search", body: "## Goal\n\nAdd search.\n\n## Acceptance criteria\n- [ ] search matches case-insensitively\n", state: "open", url: "u", labels: [] },
		}),
	});
	assert.match(ctx, /## PR #1/);
	assert.match(ctx, /Add search/);
	assert.match(ctx, /PR diff summary/);
	assert.match(ctx, /src\/core\/search\.ts/);
	assert.match(ctx, /Linked issue #1/);
	assert.match(ctx, /Acceptance criteria/);
	assert.match(ctx, /search matches case-insensitively/);
});

test("buildReviewContext includes policy excerpts and review rules", async () => {
	const dir = await makeWorkspace({
		"policies/testing-policy.md": "# Testing Policy\n\nEvery change adds tests.\n",
	});
	const ctx = await buildReviewContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([], [pr(1, ["pi:review-needed"])]),
		decision: { decision: "review", persona: "review-engineer", reason: "PR ready for review" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /## Policy excerpts/);
	assert.match(ctx, /Every change adds tests/);
	assert.match(ctx, /## Review rules/);
	assert.match(ctx, /PI-REVIEW/);
});

test("buildReviewContext handles no target PR gracefully", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildReviewContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state(),
		decision: { decision: "review", persona: "review-engineer", reason: "no PR" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /No PR is awaiting review/);
	assert.match(ctx, /nothing to review/);
});

test("buildReviewContext defaults reviewerCanPushTestCommits to false", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildReviewContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } }, // no review section
		state: state([], [pr(1, ["pi:review-needed"])]),
		decision: { decision: "review", persona: "review-engineer", reason: "PR ready for review" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /reviewerCanPushTestCommits: false/);
	assert.match(ctx, /must NOT/);
});

test("prepareRun supports the custom Review Engineer context builder", async () => {
	const dir = await makeWorkspace();
	const runId = newRunId("review-engineer");
	const { contextFile } = await prepareRun(dir, runId, {
		persona: "review-engineer",
		decision: { decision: "review", persona: "review-engineer", reason: "PR ready for review" },
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([], [pr(1, ["pi:review-needed"])]),
		buildContext: (payload) => buildReviewContext({
			workspace: dir,
			config: payload.config,
			state: payload.state,
			decision: payload.decision,
			ghFn: fakeGh(),
		}),
	});
	const text = await readFile(contextFile, "utf8");
	assert.match(text, /## Review settings/);
	assert.match(text, /## Target PR/);
});

// --- Review constants ---

test("REVIEW_COMMENT_RE matches the PI-REVIEW format", () => {
	const m = REVIEW_COMMENT_RE.exec("PI-REVIEW type=missing-tests severity=blocking location=src/core/search.ts:12");
	assert.ok(m);
	assert.equal(m[1], "missing-tests");
	assert.equal(m[2], "blocking");
	assert.equal(m[3], "src/core/search.ts:12");
});

test("REVIEW_REASONS covers the allowed review reasons", () => {
	assert.equal(REVIEW_REASONS.FAILING_TESTS, "failing-tests");
	assert.equal(REVIEW_REASONS.MISSING_TESTS, "missing-tests");
	assert.equal(REVIEW_REASONS.ACCEPTANCE_COVERAGE, "acceptance-coverage");
	assert.equal(REVIEW_REASONS.BROKEN_BUILD, "broken-build");
	assert.equal(REVIEW_REASONS.LINT_FAILURE, "lint-failure");
	assert.equal(REVIEW_REASONS.COVERAGE_FAILURE, "coverage-failure");
	assert.equal(REVIEW_REASONS.UI_BUSINESS_LOGIC, "ui-business-logic");
	assert.equal(REVIEW_REASONS.UNSAFE_DEPENDENCY, "unsafe-dependency");
	assert.equal(REVIEW_REASONS.SECRETS, "secrets");
	assert.equal(REVIEW_REASONS.INCORRECT_CORE, "incorrect-core");
});

test("REVIEW_SEVERITIES covers blocking/warning/info", () => {
	assert.equal(REVIEW_SEVERITIES.BLOCKING, "blocking");
	assert.equal(REVIEW_SEVERITIES.WARNING, "warning");
	assert.equal(REVIEW_SEVERITIES.INFO, "info");
});

test("REVIEW_COMMANDS lists the per-PR verification commands", () => {
	assert.deepEqual(REVIEW_COMMANDS, [
		"npm ci",
		"npm run lint",
		"npm test",
		"npm run test:coverage",
		"npm run build",
	]);
});

test("MISSING_TEST_CASES covers the detection cases", () => {
	assert.ok(MISSING_TEST_CASES.includes("empty / invalid input"));
	assert.ok(MISSING_TEST_CASES.includes("duplicates"));
	assert.ok(MISSING_TEST_CASES.includes("case sensitivity"));
	assert.ok(MISSING_TEST_CASES.includes("boundaries (min/max/off-by-one)"));
	assert.ok(MISSING_TEST_CASES.includes("error / async paths"));
	assert.ok(MISSING_TEST_CASES.includes("malformed data"));
	assert.ok(MISSING_TEST_CASES.includes("missing fields"));
});

test("REVIEWER_CAN_PUSH_TEST_COMMITS_DEFAULT is false", () => {
	assert.equal(REVIEWER_CAN_PUSH_TEST_COMMITS_DEFAULT, false);
});

test("Review labels are defined in constants", () => {
	assert.equal(LABELS.APPROVED, "pi:approved");
	assert.equal(LABELS.MERGE_READY, "pi:merge-ready");
	assert.equal(LABELS.CHANGES_REQUESTED, "pi:changes-requested");
	assert.equal(LABELS.REVIEW_NEEDED, "pi:review-needed");
});
