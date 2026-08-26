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
	manifestUncheckedSubissues,
	manifestHasRemainingScope,
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

// --- Manifest scope extraction (PM backlog) ---

test("manifestUncheckedSubissues lists only unchecked [ ] sub-issues grouped by milestone", () => {
	const manifest = `# M\n\n**Status: in-progress (M1 partial)**\n\n### M1 — First\n\nSub-issues:\n  - [x] M1-T1 done thing (#1)\n  - [ ] M1-T2 pending thing (#2) — planned next\n\n### M2 — Second\n\nSub-issues:\n  - [ ] M2-T1 another pending (#3)\n\n### M3 — Third\n\nScope:\n  - [ ] not a sub-issue (plain goal box)\n`;
	const out = manifestUncheckedSubissues(manifest);
	assert.match(out, /### M1/);
	assert.match(out, /M1-T2/);
	assert.doesNotMatch(out, /M1-T1/); // checked → excluded
	assert.match(out, /### M2/);
	assert.match(out, /M2-T1/);
	assert.doesNotMatch(out, /M3/); // only goal checkbox under M3, no sub-issue → excluded
});

test("manifestUncheckedSubissues returns empty string for complete manifest", () => {
	const manifest = `# M\n**Status: done**\n### M1 — First\n\nSub-issues:\n  - [x] M1-T1 done thing (#1)\n`;
	assert.equal(manifestUncheckedSubissues(manifest), "");
	assert.equal(manifestUncheckedSubissues(null), "");
});

test("manifestHasRemainingScope is true when unchecked sub-issues remain or status not done", () => {
	// unchecked sub-issues remain even if status line says done
	assert.equal(
		manifestHasRemainingScope("# M\n**Status: done**\n### M1\n  - [ ] M1-T1 pending (#1)\n"),
		true,
	);
	// in-progress status → work remains
	assert.equal(manifestHasRemainingScope("# M\n**Status: in-progress**\n### M1\n  - [x] M1-T1 done\n"), true);
	// done status + no unchecked sub-issues → complete
	assert.equal(
		manifestHasRemainingScope("# M\n**Status: done**\n### M1\n  - [x] M1-T1 done\n"),
		false,
	);
	// missing manifest → assume work remains (never suppress the PM)
	assert.equal(manifestHasRemainingScope(null), true);
});

test("buildPmContext includes the unchecked sub-issue backlog section", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-pm-ctx-"));
	await writeFile(
		join(dir, "manifest.md"),
		"# App — Manifest\n\n## Goals\n- Deliver a slice.\n\n### M20 — Scope\n\nSub-issues:\n  - [ ] M20-T1 No way to step on the water (#146) — `pi:ready`\n  - [x] M20-T2 Done already (#147)\n",
	);
	await writeFile(join(dir, "project-state.md"), "# State\n");
	await writeFile(join(dir, "CHANGELOG.md"), "# Changelog\n");
	const ctx = await buildPmContext({
		workspace: dir,
		config: { project: { owner: "octocat", repo: "repo" } },
		state: { issues: [], prs: [], ci: {}, fullName: "octocat/repo" },
		decision: { decision: "pm", persona: "pm", reason: "no open issues" },
		ghFn: async () => ({ ok: true, stdout: "[]", stderr: "", exitCode: 0 }),
	});
	assert.match(ctx, /Manifest — unchecked sub-issues/);
	assert.match(ctx, /M20-T1 No way to step on the water/);
	// The checklist backlog section (after the "Manifest — unchecked sub-issues"
	// header) must NOT contain the already-checked M20-T2 item, even though the
	// raw manifest excerpt above it does.
	const backlog = ctx.slice(ctx.indexOf("Manifest — unchecked sub-issues"));
	assert.doesNotMatch(backlog, /M20-T2 Done already/);
});
