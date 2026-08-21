/**
 * M10 logging & execution summary tests.
 *
 * Covers the logging skill core (plan.md §20): run/error/summary JSONL logs,
 * latest.log, token-usage accumulation (per-day/per-cycle), summary.md
 * generation, secret redaction, and config-driven rotation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, access, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	redactSecrets,
	appendRunRecord,
	appendErrorRecord,
	writeLatestLog,
	buildRunRecord,
	readRuns,
	readErrors,
	accumulateTokens,
	readUsage,
	estimateCost,
	buildSummary,
	writeSummary,
	lastRun,
	lastRuns,
	logPaths,
	RUNS_LOG_REL,
	ERRORS_LOG_REL,
	SUMMARY_MD_REL,
	SUMMARY_JSONL_REL,
	LATEST_LOG_REL,
	USAGE_LOG_REL,
	EVENTS_LOG_REL,
	HEALTH_LOG_REL,
	appendEvent,
	readEvents,
	appendHealth,
	readHealth,
	parseGitCommands,
	classifyGitCommand,
	loggingOptions,
} from "../skills/logging/core.js";

async function makeWorkspace() {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-logging-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	return dir;
}

// --- redaction ---

test("redactSecrets scrubs GitHub/API tokens and bearer values", () => {
	const input = "token=ghp_1234567890abcdefghijklmnopqrstuvwxyz and sk-abcdef1234567890 and Bearer xoxb-1234567890-abcdef";
	const out = redactSecrets(input);
	assert.ok(!/ghp_/.test(out), "ghp_ token redacted");
	assert.ok(!/sk-abcdef/.test(out), "sk- token redacted");
	assert.ok(!/xoxb-/.test(out), "slack token redacted");
	assert.ok(!/1234567890abcdefghijklmnopqrstuvwxyz/.test(out), "token value gone");
	assert.match(out, /\[REDACTED\]/);
});

test("redactSecrets keeps key names but redacts values in assignments", () => {
	const out = redactSecrets("api_key=supersecret123 password=letmein token=abc");
	assert.match(out, /api_key/);
	assert.match(out, /password/);
	assert.match(out, /token/);
	assert.ok(!/supersecret123/.test(out));
	assert.ok(!/letmein/.test(out));
	assert.ok(!/abc/.test(out));
});

test("redactSecrets leaves plain text untouched", () => {
	const text = "The project scaffolded successfully with 12 files.";
	assert.equal(redactSecrets(text), text);
});

// --- run records ---

test("buildRunRecord fills the plan.md §20.1 schema with defaults", () => {
	const r = buildRunRecord({
		runId: "engineer-1",
		persona: "engineer",
		trigger: "loop",
		projectName: "App",
		repo: "o/r",
		tokensInput: 100,
		tokensOutput: 50,
		startedAt: "2024-01-01T00:00:00Z",
		finishedAt: "2024-01-01T00:01:00Z",
		gitSha: "abc123",
	});
	assert.equal(r.runId, "engineer-1");
	assert.equal(r.persona, "engineer");
	assert.equal(r.tokensInput, 100);
	assert.equal(r.tokensOutput, 50);
	assert.equal(r.tokensTotal, 150);
	assert.equal(r.durationSeconds, 60);
	assert.equal(r.gitSha, "abc123");
	assert.equal(r.issueNumber, null);
	assert.equal(r.prNumber, null);
	assert.equal(r.status, "ok");
	assert.equal(r.action, "ran");
});

test("appendRunRecord writes a redacted JSONL line to runs.jsonl", async () => {
	const dir = await makeWorkspace();
	const record = buildRunRecord({
		runId: "pm-1",
		persona: "pm",
		status: "ok",
		action: "ran",
		reason: "planned next slice",
	});
	await appendRunRecord(dir, record);
	const raw = await readFile(join(dir, RUNS_LOG_REL), "utf8");
	const line = raw.trim().split("\n")[0];
	const parsed = JSON.parse(line);
	assert.equal(parsed.runId, "pm-1");
	assert.equal(parsed.persona, "pm");
});

test("appendRunRecord redacts secrets embedded in record fields", async () => {
	const dir = await makeWorkspace();
	const record = buildRunRecord({
		runId: "engineer-2",
		persona: "engineer",
		error: "auth failed with ghp_1234567890abcdefghijklmnopqrstuvwxyz",
	});
	await appendRunRecord(dir, record);
	const raw = await readFile(join(dir, RUNS_LOG_REL), "utf8");
	assert.ok(!/ghp_/.test(raw), "secret not in runs.jsonl");
	assert.match(raw, /\[REDACTED\]/);
});

test("readRuns returns parsed records and skips malformed lines", async () => {
	const dir = await makeWorkspace();
	await writeFile(
		join(dir, RUNS_LOG_REL),
		[JSON.stringify({ runId: "a", persona: "pm" }), "not-json", "", JSON.stringify({ runId: "b", persona: "engineer" })].join("\n"),
		"utf8",
	);
	const runs = await readRuns(dir);
	assert.equal(runs.length, 2);
	assert.equal(runs[0].runId, "a");
	assert.equal(runs[1].runId, "b");
});

// --- error records ---

test("appendErrorRecord writes to errors.jsonl and readErrors parses it", async () => {
	const dir = await makeWorkspace();
	await appendErrorRecord(dir, { persona: "engineer", error: "build failed" });
	await appendErrorRecord(dir, { persona: "pm", error: "gh timeout" });
	const errors = await readErrors(dir);
	assert.equal(errors.length, 2);
	assert.equal(errors[0].error, "build failed");
	assert.equal(errors[1].persona, "pm");
	assert.ok(errors[0].at, "error record carries a timestamp");
});

test("appendErrorRecord redacts secrets", async () => {
	const dir = await makeWorkspace();
	await appendErrorRecord(dir, { error: "token sk-abcdef1234567890 invalid" });
	const raw = await readFile(join(dir, ERRORS_LOG_REL), "utf8");
	assert.ok(!/sk-abcdef/.test(raw));
});

// --- latest.log ---

test("writeLatestLog writes redacted latest.log", async () => {
	const dir = await makeWorkspace();
	await writeLatestLog(dir, "running persona engineer with Bearer xoxb-abc123-xyz");
	const raw = await readFile(join(dir, LATEST_LOG_REL), "utf8");
	assert.ok(!/xoxb-abc/.test(raw));
	assert.match(raw, /\[REDACTED\]/);
});

// --- token accumulation ---

test("accumulateTokens appends per-day/per-cycle usage records", async () => {
	const dir = await makeWorkspace();
	await accumulateTokens(dir, { tokensInput: 100, tokensOutput: 50, cycle: 1 });
	await accumulateTokens(dir, { tokensInput: 40, tokensOutput: 10, cycle: 1 });
	await accumulateTokens(dir, { tokensInput: 200, tokensOutput: 100, cycle: 2 });
	const usage = await readUsage(dir);
	const today = new Date().toISOString().slice(0, 10);
	assert.equal(usage.byDay[today].tokensTotal, 500);
	assert.equal(usage.byDay[today].runs, 3);
	assert.equal(usage.byCycle["1"].tokensTotal, 200);
	assert.equal(usage.byCycle["2"].tokensTotal, 300);
	assert.equal(usage.totals.tokensTotal, 500);
});

// --- cost estimation ---

test("estimateCost uses a default blended rate", () => {
	assert.equal(estimateCost(1_000_000), 4);
	assert.equal(estimateCost(500_000), 2);
	assert.equal(estimateCost(0), 0);
});

// --- summary ---

test("buildSummary generates markdown with last run, today's totals, active work", async () => {
	const dir = await makeWorkspace();
	const last = buildRunRecord({
		runId: "engineer-9",
		persona: "engineer",
		status: "ok",
		action: "ran",
		reason: "implemented issue",
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		tokensInput: 100,
		tokensOutput: 50,
		durationSeconds: 30,
	});
	await appendRunRecord(dir, last);
	const { md, record } = await buildSummary({
		workspace: dir,
		config: { project: { name: "App", owner: "octocat", repo: "repo" } },
		state: {
			issues: [{ number: 1, title: "Add search", labels: ["pi:ready"] }],
			prs: [{ number: 2, title: "PR", review: "approved", mergeable: true }],
			mergedPrs: [{ number: 3, title: "Merged PR" }],
		},
		lastRun: last,
	});
	assert.match(md, /# auto-pi execution summary/);
	assert.match(md, /engineer-9/);
	assert.match(md, /## Last run/);
	assert.match(md, /## Today/);
	assert.match(md, /## Active work/);
	assert.match(md, /#1 Add search/);
	assert.match(md, /#2 PR/);
	assert.match(md, /#3 Merged PR/);
	assert.match(md, /octocat\/repo/);
	assert.equal(record.runId, undefined); // record uses lastRun object, not top-level
	assert.equal(record.lastRun.runId, "engineer-9");
	assert.equal(record.openIssues, 1);
	assert.equal(record.openPrs, 1);
	assert.equal(record.projectState, "active");
});

test("writeSummary writes summary.md and appends summary.jsonl", async () => {
	const dir = await makeWorkspace();
	const { md, record, paths } = await writeSummary({
		workspace: dir,
		config: { project: { name: "App", owner: "o", repo: "r" } },
		state: {},
	});
	await access(join(dir, SUMMARY_MD_REL));
	await access(join(dir, SUMMARY_JSONL_REL));
	await access(join(dir, LATEST_LOG_REL));
	assert.match(md, /# auto-pi execution summary/);
	assert.ok(record.generatedAt);
	const raw = await readFile(join(dir, SUMMARY_JSONL_REL), "utf8");
	const parsed = JSON.parse(raw.trim().split("\n")[0]);
	assert.equal(parsed.version, 1);
});

test("writeSummary redacts secrets from summary.md", async () => {
	const dir = await makeWorkspace();
	await writeSummary({
		workspace: dir,
		config: { project: { name: "App", owner: "o", repo: "r" } },
		state: {},
		lastRun: buildRunRecord({ runId: "x", persona: "pm", error: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" }),
	});
	const raw = await readFile(join(dir, SUMMARY_MD_REL), "utf8");
	assert.ok(!/ghp_/.test(raw));
});

// --- rotation ---

test("loggingOptions reads config overrides and defaults", () => {
	assert.deepEqual(loggingOptions({}), { maxFileSizeMb: 10, rotate: true });
	assert.deepEqual(loggingOptions({ logging: { maxFileSizeMb: 25, rotate: false } }), { maxFileSizeMb: 25, rotate: false });
	assert.deepEqual(loggingOptions({ logging: { maxFileSizeMb: 0 } }), { maxFileSizeMb: 10, rotate: true });
});

test("rollLog rolls a file that exceeds maxFileSizeMb", async () => {
	const dir = await makeWorkspace();
	const rel = ".pi/logs/runs.jsonl";
	await writeFile(join(dir, rel), "x".repeat(2 * 1024 * 1024), "utf8");
	// maxFileSizeMb=1 → 1MB max; file is 2MB → should roll.
	const rolled = await (await import("../skills/logging/core.js")).rollLog(dir, rel, { logging: { maxFileSizeMb: 1, rotate: true } });
	assert.equal(rolled, true);
	const files = await readdir(join(dir, ".pi", "logs"));
	assert.ok(files.includes("runs.jsonl.1"), "rolled file present");
});

test("rollLog is a no-op when rotation is disabled", async () => {
	const dir = await makeWorkspace();
	const rel = ".pi/logs/runs.jsonl";
	await writeFile(join(dir, rel), "x".repeat(2 * 1024 * 1024), "utf8");
	const { rollLog } = await import("../skills/logging/core.js");
	const rolled = await rollLog(dir, rel, { logging: { maxFileSizeMb: 1, rotate: false } });
	assert.equal(rolled, false);
});

// --- lastRun / lastRuns ---

test("lastRun and lastRuns return the most recent records", async () => {
	const dir = await makeWorkspace();
	await appendRunRecord(dir, buildRunRecord({ runId: "a", persona: "pm" }));
	await appendRunRecord(dir, buildRunRecord({ runId: "b", persona: "engineer" }));
	await appendRunRecord(dir, buildRunRecord({ runId: "c", persona: "review-engineer" }));
	const last = await lastRun(dir);
	assert.equal(last.runId, "c");
	const recent = await lastRuns(dir, 2);
	assert.equal(recent.length, 2);
	assert.equal(recent[0].runId, "c");
	assert.equal(recent[1].runId, "b");
});

test("logPaths resolves all log files under .pi/logs", () => {
	const p = logPaths("/ws");
	assert.equal(p.runs, "/ws/.pi/logs/runs.jsonl");
	assert.equal(p.errors, "/ws/.pi/logs/errors.jsonl");
	assert.equal(p.summaryMd, "/ws/.pi/logs/summary.md");
	assert.equal(p.usage, "/ws/.pi/logs/usage.jsonl");
	assert.equal(p.events, "/ws/.pi/logs/events.jsonl");
	assert.equal(p.health, "/ws/.pi/logs/health.jsonl");
});

// --- structured progress events (events.jsonl) ---

test("appendEvent writes a structured event and readEvents returns newest-first", async () => {
	const dir = await makeWorkspace();
	await appendEvent(dir, { type: "persona.spawned", persona: "engineer", runId: "r1", data: { decision: "engineer" } });
	await appendEvent(dir, { type: "pr.merged", persona: "engineer", runId: "r2", data: { prNumber: 7 } });

	const events = await readEvents(dir);
	assert.equal(events.length, 2);
	// newest first
	assert.equal(events[0].type, "pr.merged");
	assert.equal(events[0].data.prNumber, 7);
	assert.equal(events[1].type, "persona.spawned");
	assert.ok(events[0].id, "event has an id");
	assert.ok(events[0].at, "event has a timestamp");
	await access(join(dir, EVENTS_LOG_REL));
});

test("appendEvent ignores events without a type and never throws", async () => {
	const dir = await makeWorkspace();
	const r = await appendEvent(dir, { data: { x: 1 } });
	assert.equal(r, null);
	const events = await readEvents(dir);
	assert.equal(events.length, 0);
});

// --- LLM provider health (health.jsonl) ---

test("appendHealth writes a health record and readHealth sums success/failure", async () => {
	const dir = await makeWorkspace();
	await appendHealth(dir, { provider: "openai", model: "gpt-4o", runId: "r1", persona: "pm", ok: true, exitCode: 0 });
	await appendHealth(dir, { provider: "openai", model: "gpt-4o", runId: "r2", persona: "engineer", ok: false, exitCode: 1, retryable: true, retries: 1 });
	await appendHealth(dir, { provider: "openai", model: "gpt-4o", runId: "r3", persona: "engineer", ok: true, exitCode: 0 });

	const health = await readHealth(dir);
	assert.equal(health.length, 3);
	// newest first
	assert.equal(health[0].ok, true);
	assert.equal(health[1].ok, false);
	assert.equal(health[1].retryable, true);
	await access(join(dir, HEALTH_LOG_REL));
});

// --- git/gh command parsing + classification ---

test("parseGitCommands extracts git and gh commands from persona output", () => {
	const out = [
		"$ git checkout -b task/1-fix",
		"$ git add .",
		"$ git commit -m 'fix: thing'",
		"$ git push -u origin task/1-fix",
		"$ gh issue create --title 'T1' --label 'pi:ready'",
		"$ gh pr create --title 'PR' --label 'pi:review-needed'",
		"$ gh pr review --approve --comment 'LGTM'",
		"$ gh pr merge --squash",
		"the engineer ran git status to check",
	].join("\n");
	const cmds = parseGitCommands(out);
	const kinds = cmds.map((c) => c.kind);
	assert.ok(kinds.includes("git"));
	assert.ok(kinds.includes("gh"));
	// prose mention "git status" mid-sentence must NOT match
	assert.ok(!cmds.some((c) => c.command === "git status"));
	// duplicates collapsed
	const dup = parseGitCommands("$ git add .\n$ git add .");
	assert.equal(dup.length, 1);
});

test("classifyGitCommand maps lifecycle commands to event types", () => {
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh issue create --title X" }).type, "issue.created");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh pr create --title X" }).type, "pr.created");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh pr review --approve" }).type, "pr.approved");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh pr review --request-changes" }).type, "pr.changes_requested");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh pr merge --squash" }).type, "pr.merged");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh pr comment --body ok" }).type, "pr.commented");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh api repos/o/r/issues/1/labels -f labels=pi:ready" }).type, "labels.assigned");
	assert.equal(classifyGitCommand({ kind: "git", command: "git commit -m x" }).type, "git.commit");
	assert.equal(classifyGitCommand({ kind: "git", command: "git push -u origin x" }).type, "git.push");
	assert.equal(classifyGitCommand({ kind: "gh", command: "gh pr checks" }).type, "gh.command");
});

// --- loop integration: a stopped cycle logs a run record + summary ---

test("runLoopCycle (stopped) writes a run record and summary.md", async () => {
	const dir = await makeWorkspace();
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await writeFile(join(dir, ".pi", "state", "stop"), new Date().toISOString(), "utf8");
	await writeFile(
		join(dir, ".pi", "config.json"),
		JSON.stringify({ project: { owner: "o", repo: "r", name: "App" } }),
		"utf8",
	);
	const cpFile = join(dir, "current-project.json");
	await writeFile(cpFile, JSON.stringify({ workspace: dir, repo: "o/r" }), "utf8");

	const { runLoopCycle } = await import("../extensions/loop/orchestrator.js");
	const result = await runLoopCycle(dir, { log: () => {} }, {
		gh: async () => ({ ok: true, stdout: "[]", stderr: "", exitCode: 0 }),
		currentProjectFile: cpFile,
	});

	assert.equal(result.action, "stopped");
	const runs = await readRuns(dir);
	assert.equal(runs.length, 1);
	assert.equal(runs[0].action, "stopped");
	assert.equal(runs[0].status, "stopped");
	assert.equal(runs[0].repo, "o/r");
	await access(join(dir, SUMMARY_MD_REL));
	const md = await readFile(join(dir, SUMMARY_MD_REL), "utf8");
	assert.match(md, /# auto-pi execution summary/);
});
