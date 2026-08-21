/**
 * M6 loop orchestrator tests.
 *
 * Covers the dispatcher (§15 dispatch order), state scanner, persona runner
 * (fresh sessions, run dirs, ledger), and the orchestrator (lock, stop file,
 * active-project check, one-cycle run).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, DECISION, PERSONAS } from "../extensions/loop/dispatcher.js";
import {
	scanGithubState,
	readBudgetUsage,
	budgetExceeded,
} from "../extensions/loop/state-scanner.js";
import { newRunId, buildContext, prepareRun } from "../extensions/loop/persona-runner.js";
import {
	acquireLock,
	checkLock,
	releaseLock,
	isStopped,
	readConfig,
	readActiveProject,
	runLoopCycle,
	writeStopFile,
} from "../extensions/loop/orchestrator.js";
import { STOP_FILE_REL } from "../extensions/loop/constants.js";

/** Build a minimal scanned state. */
function state(issues = [], prs = []) {
	return { issues, prs, ci: { status: "completed", conclusion: "success" }, scannedAt: new Date().toISOString() };
}

const issue = (number, labels = []) => ({ number, title: `Issue ${number}`, labels, review: "none" });
const pr = (number, labels = [], review = "none", mergeable = false) => ({
	number,
	title: `PR ${number}`,
	labels,
	review,
	mergeable,
});

test("dispatch: stop file present → stop", () => {
	const d = dispatch({ stopped: true, budget: { exceeded: false }, needsHuman: false, state: state() });
	assert.equal(d.decision, DECISION.STOP);
});

test("dispatch: budget exceeded → stop", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: true, reason: "token budget exceeded" },
		needsHuman: false,
		state: state(),
	});
	assert.equal(d.decision, DECISION.STOP);
	assert.match(d.reason, /budget/);
});

test("dispatch: initiation needs human → wait", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: true,
		state: state(),
	});
	assert.equal(d.decision, DECISION.WAIT);
});

test("dispatch: PR with changes requested → Engineer", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([], [pr(1, [], "changes_requested")]),
	});
	assert.equal(d.decision, DECISION.ENGINEER);
	assert.equal(d.persona, PERSONAS.ENGINEER);
});

test("dispatch: PR approved + merge-ready → Engineer/Merge", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([], [pr(2, ["pi:merge-ready"], "approved", true)]),
	});
	assert.equal(d.decision, DECISION.ENGINEER_MERGE);
	assert.equal(d.persona, PERSONAS.ENGINEER);
});

test("dispatch: PR ready for review → Review Engineer", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([], [pr(3, ["pi:review-requested"], "none", false)]),
	});
	assert.equal(d.decision, DECISION.REVIEW);
	assert.equal(d.persona, PERSONAS.REVIEW);
});

test("dispatch: open issue with unresolved PM notes → PM", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(1, ["pi:pm-note"])]),
	});
	assert.equal(d.decision, DECISION.PM);
	assert.equal(d.persona, PERSONAS.PM);
});

test("dispatch: open ready issue → Engineer", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(1, ["pi:ready"])]),
	});
	assert.equal(d.decision, DECISION.ENGINEER);
	assert.equal(d.persona, PERSONAS.ENGINEER);
});

test("dispatch: otherwise → PM (plan next slice)", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state(),
	});
	assert.equal(d.decision, DECISION.PM);
	assert.equal(d.persona, PERSONAS.PM);
});

test("dispatch order: changes-requested beats ready issue", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(1, ["pi:ready"])], [pr(1, [], "changes_requested")]),
	});
	assert.equal(d.decision, DECISION.ENGINEER);
	assert.match(d.reason, /changes requested/);
});

test("one-PR-at-a-time: ready issues + open PR → Review, not a new Engineer", () => {
	// Even with remaining pi:ready issues, an open PR must block new
	// implementations so only one PR is ever in flight at a time.
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(1, ["pi:ready"]), issue(2, ["pi:ready"])], [pr(10, ["pi:review-needed"], "none")]),
	});
	assert.equal(d.decision, DECISION.REVIEW);
	assert.equal(d.persona, PERSONAS.REVIEW);
});

test("dispatch: freshly-opened PR with pi:review-needed → Review Engineer", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([], [pr(5, ["pi:review-needed"], "none")]),
	});
	assert.equal(d.decision, DECISION.REVIEW);
	assert.equal(d.persona, PERSONAS.REVIEW);
});

test("dispatch: open PR in an unknown state → Review (never new impl while PR open)", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(1, ["pi:ready"])], [pr(7, [], "none")]),
	});
	assert.equal(d.decision, DECISION.REVIEW);
	assert.equal(d.persona, PERSONAS.REVIEW);
	assert.notEqual(d.reason, "an open issue is ready to implement");
});

test("dispatch: approved but not merge-ready PR → Engineer/Merge (resolve conflict)", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(1, ["pi:ready"])], [pr(8, [], "approved", false)]), // approved, not mergeable
	});
	assert.equal(d.decision, DECISION.ENGINEER_MERGE);
	assert.equal(d.persona, PERSONAS.ENGINEER);
});

test("dispatch: after all PRs merged, ready issue → Engineer (next task)", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([issue(2, ["pi:ready"])], []), // no open PRs
	});
	assert.equal(d.decision, DECISION.ENGINEER);
	assert.equal(d.persona, PERSONAS.ENGINEER);
});

test("dispatch: no PRs and no issues → PM (finalize)", () => {
	const d = dispatch({
		stopped: false,
		budget: { exceeded: false },
		needsHuman: false,
		state: state([], []),
	});
	assert.equal(d.decision, DECISION.PM);
	assert.equal(d.persona, PERSONAS.PM);
});

// --- state scanner ---

function fakeGh(issues, prs) {
	return async (args) => {
		if (args[0] === "issue") {
			return { ok: true, stdout: JSON.stringify(issues), stderr: "", exitCode: 0 };
		}
		if (args[0] === "pr") {
			return { ok: true, stdout: JSON.stringify(prs), stderr: "", exitCode: 0 };
		}
		if (args[0] === "run") {
			return { ok: true, stdout: JSON.stringify([{ status: "completed", conclusion: "success" }]), stderr: "", exitCode: 0 };
		}
		return { ok: false, stdout: "", stderr: "unexpected", exitCode: 1 };
	};
}

test("scanGithubState reads issues, PRs, labels, review, CI", async () => {
	const ghFn = fakeGh(
		[{ number: 1, title: "a", body: "b", labels: [{ name: "pi:ready" }], url: "u", createdAt: "t", updatedAt: "t" }],
		[{ number: 2, title: "c", headRefName: "f", baseRefName: "main", labels: [{ name: "pi:review-requested" }], reviewDecision: "REVIEW_REQUESTED", mergeable: "MERGEABLE", url: "u", createdAt: "t", updatedAt: "t" }],
	);
	const res = await scanGithubState("octocat", "repo", ghFn);
	assert.equal(res.ok, true);
	assert.equal(res.state.issues.length, 1);
	assert.deepEqual(res.state.issues[0].labels, ["pi:ready"]);
	assert.equal(res.state.prs.length, 1);
	assert.equal(res.state.prs[0].review, "review_requested");
	assert.equal(res.state.prs[0].mergeable, true);
	assert.equal(res.state.ci.conclusion, "success");
});

test("scanGithubState reports error on gh failure", async () => {
	const ghFn = async () => ({ ok: false, stdout: "", stderr: "boom", exitCode: 1 });
	const res = await scanGithubState("o", "r", ghFn);
	assert.equal(res.ok, false);
	assert.match(res.error, /boom/);
});

test("readBudgetUsage sums tokens/cost from the ledger", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-budget-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	await writeFile(
		join(dir, ".pi", "logs", "runs.jsonl"),
		[
			JSON.stringify({ tokensUsed: 100, costUsd: 0.5 }),
			JSON.stringify({ tokensUsed: 200, costUsd: 1.0 }),
			"not-json",
			"",
		].join("\n"),
		"utf8",
	);
	const usage = await readBudgetUsage(dir);
	assert.equal(usage.tokensUsed, 300);
	assert.equal(usage.costUsd, 1.5);
	assert.equal(usage.runs, 2);
});

test("budgetExceeded respects config limits", () => {
	assert.equal(budgetExceeded({ limits: { maxTokensPerDay: 1000 } }, { tokensUsed: 500, costUsd: 0 }).exceeded, false);
	assert.equal(budgetExceeded({ limits: { maxTokensPerDay: 1000 } }, { tokensUsed: 1500, costUsd: 0 }).exceeded, true);
	assert.equal(budgetExceeded({ limits: { maxCostPerDayUsd: 5 } }, { tokensUsed: 0, costUsd: 6 }).exceeded, true);
});

// --- persona runner ---

test("newRunId includes persona and is unique", () => {
	const a = newRunId("engineer");
	const b = newRunId("engineer");
	assert.match(a, /^engineer-/);
	assert.notEqual(a, b);
});

test("buildContext includes project, dispatch, and GitHub state", () => {
	const ctx = buildContext({
		config: { project: { name: "App", owner: "o", repo: "r", defaultBranch: "main", demoUrl: "u" } },
		state: state([issue(1, ["pi:ready"])], [pr(2, [], "approved", true)]),
		decision: { decision: "engineer", persona: "engineer", reason: "ready issue" },
	});
	assert.match(ctx, /## Project/);
	assert.match(ctx, /App/);
	assert.match(ctx, /#1/);
	assert.match(ctx, /#2/);
	assert.match(ctx, /engineer/);
});

test("prepareRun writes context file and returns run dir", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-run-"));
	const runId = newRunId("pm");
	const { runDir, contextFile } = await prepareRun(dir, runId, {
		persona: "pm",
		decision: { decision: "pm", persona: "pm", reason: "plan" },
		config: {},
		state: state(),
	});
	assert.match(runDir, new RegExp(runId));
	await access(contextFile);
	const text = await readFile(contextFile, "utf8");
	assert.match(text, /plan/);
});

// --- orchestrator: lock, stop, active project, cycle ---

test("acquireLock refuses a second loop for the same project", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-lock-"));
	const first = await acquireLock(dir);
	assert.equal(first.ok, true);
	// Simulate a live lock owned by this process (PID alive).
	const second = await acquireLock(dir);
	assert.equal(second.ok, false);
	assert.match(second.message, /already running/);
	const released = await releaseLock(dir);
	assert.equal(released, true);
});

test("checkLock detects a live lock and a stale lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-lock-"));
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await writeFile(join(dir, ".pi", "state", "loop.lock"), JSON.stringify({ pid: process.pid }), "utf8");
	const live = await checkLock(dir);
	assert.equal(live.locked, true);
	assert.equal(live.pid, process.pid);
	// Stale: a PID that cannot exist (max int) → not alive.
	await writeFile(join(dir, ".pi", "state", "loop.lock"), JSON.stringify({ pid: 2147483647 }), "utf8");
	const stale = await checkLock(dir);
	assert.equal(stale.locked, false);
	assert.equal(stale.stale, true);
});

test("isStopped reflects the stop file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-stop-"));
	assert.equal(await isStopped(dir), false);
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await writeFile(join(dir, STOP_FILE_REL), new Date().toISOString(), "utf8");
	assert.equal(await isStopped(dir), true);
});

test("writeStopFile creates the stop file and isStopped returns true", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-stop-"));
	const stopFile = await writeStopFile(dir);
	assert.match(stopFile, /stop$/);
	await access(stopFile);
	assert.equal(await isStopped(dir), true);
});

test("readConfig parses .pi/config.json", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-cfg-"));
	await mkdir(join(dir, ".pi"), { recursive: true });
	await writeFile(join(dir, ".pi", "config.json"), JSON.stringify({ loop: { intervalSeconds: 30 } }), "utf8");
	const res = await readConfig(dir);
	assert.equal(res.ok, true);
	assert.equal(res.config.loop.intervalSeconds, 30);
});

test("readActiveProject reads the per-machine record", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-active-"));
	const cpFile = join(dir, "current-project.json");
	await writeFile(cpFile, JSON.stringify({ workspace: "/tmp/w", repo: "o/r", projectName: "R" }), "utf8");
	const res = await readActiveProject(cpFile);
	assert.equal(res.ok, true);
	assert.equal(res.active.repo, "o/r");
});

test("runLoopCycle stops when the stop file exists (no persona launched)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-cycle-"));
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await writeFile(join(dir, STOP_FILE_REL), new Date().toISOString(), "utf8");
	await mkdir(join(dir, ".pi"), { recursive: true });
	await writeFile(join(dir, ".pi", "config.json"), JSON.stringify({ project: { owner: "o", repo: "r" } }), "utf8");

	const cpFile = join(dir, "current-project.json");
	await writeFile(cpFile, JSON.stringify({ workspace: dir, repo: "o/r" }), "utf8");

	const result = await runLoopCycle(dir, { log: () => {} }, {
		gh: async () => ({ ok: true, stdout: "[]", stderr: "", exitCode: 0 }),
		currentProjectFile: cpFile,
	});
	assert.equal(result.action, "stopped");
	assert.equal(result.decision, DECISION.STOP);
});

test("runLoopCycle does not stop on budget when stopOnBudgetExceeded=false (M13)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-budget-off-"));
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	// Budget is exceeded (tokens used >= maxTokensPerDay=1) but the loop must
	// NOT stop because stopOnBudgetExceeded=false.
	await writeFile(join(dir, ".pi", "config.json"), JSON.stringify({
		project: { owner: "o", repo: "r", name: "R" },
		loop: { stopOnBudgetExceeded: false, intervalSeconds: 30 },
		limits: { maxTokensPerDay: 1 },
	}), "utf8");
	await writeFile(join(dir, ".pi", "logs", "runs.jsonl"),
		JSON.stringify({ tokensUsed: 999, costUsd: 0, status: "ok" }) + "\n", "utf8");

	const cpFile = join(dir, "current-project.json");
	await writeFile(cpFile, JSON.stringify({ workspace: dir, repo: "o/r" }), "utf8");

	const result = await runLoopCycle(dir, { log: () => {} }, {
		gh: async () => ({ ok: true, stdout: "[]", stderr: "", exitCode: 0 }),
		currentProjectFile: cpFile,
		dryRun: true,
	});
	// Not stopped — the loop continues (dry-run would run a persona).
	assert.notEqual(result.action, "stopped");
	assert.equal(result.action, "ran");
});

test("runLoopCycle stops on budget when stopOnBudgetExceeded=true (default, M13)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-budget-on-"));
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	await writeFile(join(dir, ".pi", "config.json"), JSON.stringify({
		project: { owner: "o", repo: "r", name: "R" },
		limits: { maxTokensPerDay: 1 },
	}), "utf8");
	await writeFile(join(dir, ".pi", "logs", "runs.jsonl"),
		JSON.stringify({ tokensUsed: 999, costUsd: 0, status: "ok" }) + "\n", "utf8");

	const cpFile = join(dir, "current-project.json");
	await writeFile(cpFile, JSON.stringify({ workspace: dir, repo: "o/r" }), "utf8");

	const result = await runLoopCycle(dir, { log: () => {} }, {
		gh: async () => ({ ok: true, stdout: "[]", stderr: "", exitCode: 0 }),
		currentProjectFile: cpFile,
	});
	assert.equal(result.action, "stopped");
	assert.match(result.reason, /budget/);
});
