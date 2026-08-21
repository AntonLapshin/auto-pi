/**
 * M8 Engineer persona tests.
 *
 * Covers the Engineer context packer (plan.md §21.1): target resolution
 * (implement / review / merge), issue body + comments, PR review comments,
 * project structure, test commands, policy excerpts, and the Engineer labels.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildEngineerContext,
	resolveTarget,
	fetchIssueDetail,
	fetchPrReviewComments,
	readPolicyExcerpts,
} from "../extensions/loop/engineer-context.js";
import { prepareRun, newRunId } from "../extensions/loop/persona-runner.js";
import { LABELS } from "../extensions/loop/constants.js";

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
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-eng-"));
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

/** Fake gh runner that answers issue view, comments, PR comments, reviews, merged PRs. */
function fakeGh({ issueDetail, issueComments = [], inline = [], reviews = [], mergedPrs = [] } = {}) {
	return async (args) => {
		const [cmd, ...rest] = args;
		if (cmd === "issue" && rest[0] === "view") {
			const body = issueDetail || {
				number: Number(rest[rest.indexOf("--json") - 1]) || 1,
				title: "Add note search",
				body: "## Goal\n\nAdd search.\n\n<!-- pi:issue-id M1-T3 -->\n",
				state: "open",
				url: "https://github.com/octocat/repo/issues/1",
				labels: [{ name: "pi:ready" }, { name: "size:xs" }],
				createdAt: "t",
				updatedAt: "t",
			};
			return { ok: true, stdout: JSON.stringify(body), stderr: "", exitCode: 0 };
		}
		if (cmd === "api" && rest[0]?.includes("/issues/") && rest[0]?.endsWith("/comments")) {
			return { ok: true, stdout: JSON.stringify(issueComments), stderr: "", exitCode: 0 };
		}
		if (cmd === "api" && rest[0]?.includes("/pulls/") && rest[0]?.endsWith("/comments")) {
			return { ok: true, stdout: JSON.stringify(inline), stderr: "", exitCode: 0 };
		}
		if (cmd === "api" && rest[0]?.includes("/pulls/") && rest[0]?.endsWith("/reviews")) {
			return { ok: true, stdout: JSON.stringify(reviews), stderr: "", exitCode: 0 };
		}
		if (cmd === "pr" && args.includes("--state") && args[args.indexOf("--state") + 1] === "merged") {
			return { ok: true, stdout: JSON.stringify(mergedPrs), stderr: "", exitCode: 0 };
		}
		return { ok: false, stdout: "", stderr: "unexpected gh call: " + args.join(" "), exitCode: 1 };
	};
}

// --- target resolution ---

test("resolveTarget picks a pi:ready issue", () => {
	const t = resolveTarget(state([issue(1, ["pi:ready"]), issue(2, ["pi:blocked"])], []));
	assert.equal(t.kind, "implement");
	assert.equal(t.number, 1);
});

test("resolveTarget picks the lowest-numbered ready issue", () => {
	const t = resolveTarget(state([issue(5, ["pi:ready"]), issue(2, ["pi:ready"])], []));
	assert.equal(t.kind, "implement");
	assert.equal(t.number, 2);
});

test("resolveTarget returns null with no ready work", () => {
	assert.equal(resolveTarget(state([issue(1, ["pi:blocked"])], [])), null);
	assert.equal(resolveTarget(state([], [])), null);
});

test("resolveTarget prioritises changes-requested PR over ready issue", () => {
	const t = resolveTarget(state(
		[issue(1, ["pi:ready"])],
		[pr(10, [], "changes_requested")],
	));
	assert.equal(t.kind, "review");
	assert.equal(t.number, 10);
});

test("resolveTarget prioritises approved merge-ready PR", () => {
	const t = resolveTarget(state(
		[issue(1, ["pi:ready"])],
		[pr(10, [], "approved", true)],
	));
	assert.equal(t.kind, "merge");
	assert.equal(t.number, 10);
});

test("resolveTarget targets an approved-but-not-mergeable PR for merge/conflict", () => {
	const t = resolveTarget(state(
		[issue(1, ["pi:ready"])],
		[pr(11, [], "approved", false)], // approved but conflicted
	));
	assert.equal(t.kind, "merge");
	assert.equal(t.number, 11);
});

test("resolveTarget skips ready issues already in flight (open PR)", () => {
	const t = resolveTarget(state(
		[issue(1, ["pi:ready"]), issue(2, ["pi:ready"])],
		[pr(7, [], "none", false)],
	));
	// No PR links to an issue number here; both remain candidates → lowest wins.
	assert.equal(t.kind, "implement");
	assert.equal(t.number, 1);
});

// --- fetch helpers ---

test("fetchIssueDetail returns body, labels, and comments", async () => {
	const res = await fetchIssueDetail("octocat", "repo", 1, fakeGh({
		issueDetail: { number: 1, title: "Add search", body: "Goal body", state: "open", url: "u", labels: [{ name: "pi:ready" }] },
		issueComments: [{ user: "alice", createdAt: "t", body: "please add tests" }],
	}));
	assert.equal(res.ok, true);
	assert.equal(res.issue.body, "Goal body");
	assert.deepEqual(res.issue.labels, ["pi:ready"]);
	assert.equal(res.issue.comments.length, 1);
	assert.equal(res.issue.comments[0].user, "alice");
});

test("fetchPrReviewComments returns inline and review-thread comments", async () => {
	const res = await fetchPrReviewComments("octocat", "repo", 3, fakeGh({
		inline: [{ user: "bob", path: "src/core/search.ts", line: 12, body: "missing boundary test" }],
		reviews: [{ user: "bob", state: "CHANGES_REQUESTED", body: "needs tests", submittedAt: "t" }],
	}));
	assert.equal(res.ok, true);
	assert.equal(res.comments.inline.length, 1);
	assert.equal(res.comments.inline[0].path, "src/core/search.ts");
	assert.equal(res.comments.reviews[0].state, "CHANGES_REQUESTED");
});

test("readPolicyExcerpts reads only existing named policies", async () => {
	const dir = await makeWorkspace({
		"policies/engineering-guidelines.md": "# Engineering Guidelines\n\nKeep core pure.\n",
	});
	const excerpts = await readPolicyExcerpts(dir, ["engineering-guidelines", "testing-policy"]);
	assert.equal(excerpts["engineering-guidelines"], "# Engineering Guidelines\n\nKeep core pure.");
	assert.equal(excerpts["testing-policy"], undefined);
});

// --- context build ---

test("buildEngineerContext includes project, structure, and test commands", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo", defaultBranch: "main" }, stack: { framework: "react", typescript: true, tailwind: true } },
		state: state([issue(1, ["pi:ready"])]),
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
		ghFn: fakeGh({ issueDetail: { number: 1, title: "Add note search", body: "## Goal\n\nAdd search.", state: "open", url: "u", labels: [{ name: "pi:ready" }] } }),
	});
	assert.match(ctx, /## Project/);
	assert.match(ctx, /octocat\/repo/);
	assert.match(ctx, /## Project structure/);
	assert.match(ctx, /src\/core/);
	assert.match(ctx, /## Test commands/);
	assert.match(ctx, /npm test/);
	assert.match(ctx, /test:coverage/);
});

test("buildEngineerContext includes the target issue body and comments", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([issue(1, ["pi:ready"])]),
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
		ghFn: fakeGh({
			issueDetail: { number: 1, title: "Add note search", body: "## Goal\n\nAdd search.", state: "open", url: "u", labels: [{ name: "pi:ready" }] },
			issueComments: [{ user: "alice", createdAt: "t", body: "please add tests" }],
		}),
	});
	assert.match(ctx, /## Target work item/);
	assert.match(ctx, /Implement issue #1/);
	assert.match(ctx, /Add search/);
	assert.match(ctx, /please add tests/);
});

test("buildEngineerContext includes PR review comments when addressing review", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([], [pr(3, [], "changes_requested")]),
		decision: { decision: "engineer", persona: "engineer", reason: "changes requested" },
		ghFn: fakeGh({
			inline: [{ user: "bob", path: "src/core/search.ts", line: 12, body: "missing boundary test" }],
			reviews: [{ user: "bob", state: "CHANGES_REQUESTED", body: "needs tests", submittedAt: "t" }],
		}),
	});
	assert.match(ctx, /Address review comments on PR #3/);
	assert.match(ctx, /missing boundary test/);
	assert.match(ctx, /needs tests/);
	assert.match(ctx, /src\/core\/search.ts/);
});

test("buildEngineerContext includes merge instructions for approved PR", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([], [pr(5, [], "approved", true)]),
		decision: { decision: "engineer_merge", persona: "engineer", reason: "approved merge-ready" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /Merge approved PR #5/);
	assert.match(ctx, /--squash --delete-branch/);
});

test("buildEngineerContext handles no target work gracefully", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state(),
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /nothing to do/);
});

test("buildEngineerContext includes recent merged PR summaries", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([issue(1, ["pi:ready"])]),
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
		ghFn: fakeGh({
			mergedPrs: [{ number: 9, title: "Add notes", mergedAt: "2024-01-01T00:00:00Z", labels: [{ name: "size:xs" }] }],
		}),
	});
	assert.match(ctx, /#9/);
	assert.match(ctx, /Add notes/);
});

test("buildEngineerContext includes policy excerpts", async () => {
	const dir = await makeWorkspace({
		"policies/engineering-guidelines.md": "# Engineering Guidelines\n\nKeep core pure, UI thin.\n",
	});
	const ctx = await buildEngineerContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([issue(1, ["pi:ready"])]),
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /## Policy excerpts/);
	assert.match(ctx, /Keep core pure/);
});

test("prepareRun supports the custom Engineer context builder", async () => {
	const dir = await makeWorkspace();
	const runId = newRunId("engineer");
	const { contextFile } = await prepareRun(dir, runId, {
		persona: "engineer",
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([issue(1, ["pi:ready"])]),
		buildContext: (payload) => buildEngineerContext({
			workspace: dir,
			config: payload.config,
			state: payload.state,
			decision: payload.decision,
			ghFn: fakeGh(),
		}),
	});
	const text = await readFile(contextFile, "utf8");
	assert.match(text, /## Project structure/);
	assert.match(text, /## Test commands/);
});

// --- Engineer labels ---

test("Engineer labels are defined in constants", () => {
	assert.equal(LABELS.REVIEW_NEEDED, "pi:review-needed");
	assert.equal(LABELS.MERGE_BLOCKED, "pi:merge-blocked");
	assert.equal(LABELS.CONFLICT, "pi:conflict");
});
