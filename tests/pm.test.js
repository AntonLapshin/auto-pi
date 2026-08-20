/**
 * M7 PM persona tests.
 *
 * Covers the PM context packer (plan.md §21.1): reading manifest / project-state
 * / changelog, open issue + open PR summaries, recent merged PR summaries, policy
 * excerpts, and the PM markers/constants (PM notes, idempotency, labels).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildPmContext,
	fetchMergedPrs,
	readPolicyExcerpts,
} from "../extensions/loop/pm-context.js";
import { prepareRun, newRunId } from "../extensions/loop/persona-runner.js";
import {
	PM_NOTE_RE,
	PM_NOTE_RESOLVED,
	ISSUE_ID_RE,
	SIZES,
	TYPES,
	milestoneLabel,
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
const pr = (number, labels = []) => ({ number, title: `PR ${number}`, labels, review: "none", mergeable: false });

/** Build a workspace with the standard project files. */
async function makeWorkspace(files = {}) {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-pm-"));
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

function fakeGh(mergedPrs = []) {
	return async (args) => {
		if (args[0] === "pr" && args.includes("--state") && args[args.indexOf("--state") + 1] === "merged") {
			return { ok: true, stdout: JSON.stringify(mergedPrs), stderr: "", exitCode: 0 };
		}
		return { ok: false, stdout: "", stderr: "unexpected gh call", exitCode: 1 };
	};
}

// --- PM context packer ---

test("buildPmContext includes manifest, project-state, changelog", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildPmContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo", defaultBranch: "main", demoUrl: "" } },
		state: state(),
		decision: { decision: "pm", persona: "pm", reason: "plan" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /## Manifest/);
	assert.match(ctx, /Deliver a slice/);
	assert.match(ctx, /## Project state/);
	assert.match(ctx, /Scaffolded/);
	assert.match(ctx, /## Changelog/);
	assert.match(ctx, /Scaffold/);
});

test("buildPmContext includes open issue and open PR summaries", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildPmContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state(
			[issue(1, ["pi:ready", "size:xs"], "<!-- pi:issue-id M1-T1 -->")],
			[pr(2, ["pi:review-requested"])],
		),
		decision: { decision: "pm", persona: "pm", reason: "plan" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /#1/);
	assert.match(ctx, /#2/);
	assert.match(ctx, /pi:ready/);
});

test("buildPmContext includes recent merged PR summaries", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildPmContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state(),
		decision: { decision: "pm", persona: "pm", reason: "plan" },
		ghFn: fakeGh([
			{ number: 9, title: "Add notes", mergedAt: "2024-01-01T00:00:00Z", labels: [{ name: "size:xs" }] },
		]),
	});
	assert.match(ctx, /#9/);
	assert.match(ctx, /Add notes/);
});

test("buildPmContext handles missing project files gracefully", async () => {
	const dir = await makeWorkspace({}); // empty workspace
	const ctx = await buildPmContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state(),
		decision: { decision: "pm", persona: "pm", reason: "plan" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /No open issues/);
	assert.match(ctx, /Policy excerpts/);
});

test("buildPmContext flags PM notes and resolved markers in issue summaries", async () => {
	const dir = await makeWorkspace();
	const ctx = await buildPmContext({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state([
			issue(1, ["pi:pm-note"], "PI-NOTE persona=PM reason=scope-too-large action=split"),
			issue(2, [], "PI-NOTE persona=PM reason=x action=y\nPI-NOTE-RESOLVED"),
		]),
		decision: { decision: "pm", persona: "pm", reason: "PM notes" },
		ghFn: fakeGh(),
	});
	assert.match(ctx, /#1/);
	assert.match(ctx, /pm-note/);
	assert.match(ctx, /#2/);
	assert.match(ctx, /note-resolved/);
});

test("readPolicyExcerpts reads only existing named policies", async () => {
	const dir = await makeWorkspace({
		"policies/issue-granularity.md": "# Issue Granularity\n\nKeep issues XS/S.\n",
	});
	const excerpts = await readPolicyExcerpts(dir, ["issue-granularity", "done-definition"]);
	assert.equal(excerpts["issue-granularity"], "# Issue Granularity\n\nKeep issues XS/S.");
	assert.equal(excerpts["done-definition"], undefined);
});

test("fetchMergedPrs parses merged PR summaries", async () => {
	const merged = await fetchMergedPrs("octocat", "repo", fakeGh([
		{ number: 3, title: "Fix bug", mergedAt: "t", labels: [{ name: "type:bug" }] },
	]), 5);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].number, 3);
	assert.deepEqual(merged[0].labels, ["type:bug"]);
});

test("prepareRun supports a custom buildContext (PM packer)", async () => {
	const dir = await makeWorkspace();
	const runId = newRunId("pm");
	const { contextFile } = await prepareRun(dir, runId, {
		persona: "pm",
		decision: { decision: "pm", persona: "pm", reason: "plan" },
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: state(),
		buildContext: (payload) => buildPmContext({
			workspace: dir,
			config: payload.config,
			state: payload.state,
			decision: payload.decision,
			ghFn: fakeGh(),
		}),
	});
	const text = await readFile(contextFile, "utf8");
	assert.match(text, /## Manifest/);
	assert.match(text, /## Project state/);
});

// --- PM markers / constants ---

test("PM_NOTE_RE matches PM note lines", () => {
	const body = "Some text\nPI-NOTE persona=PM reason=scope-too-large action=split\nmore";
	const m = PM_NOTE_RE.exec(body);
	assert.ok(m);
	assert.match(m[1], /reason=scope-too-large/);
});

test("ISSUE_ID_RE parses idempotency markers", () => {
	const m = ISSUE_ID_RE.exec("<!-- pi:issue-id M1-T3 -->");
	assert.ok(m);
	assert.equal(m[1], "M1");
	assert.equal(m[2], "3");
});

test("size/type/label constants and milestoneLabel helper", () => {
	assert.equal(SIZES.XS, "size:xs");
	assert.equal(SIZES.S, "size:s");
	assert.equal(TYPES.FEATURE, "type:feature");
	assert.equal(milestoneLabel("M1"), "milestone:m1");
	assert.equal(LABELS.NEEDS_PM, "pi:needs-pm");
	assert.equal(PM_NOTE_RESOLVED, "PI-NOTE-RESOLVED");
});
