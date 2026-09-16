/**
 * esp-status v8 tests.
 *
 * Contract: the pocket monitor reports the last *meaningful* (GitHub-visible)
 * action + per-run progress (run_ok_n), not the loop heartbeat, and exposes
 * stuck/state liveness driven by loop.personaInactivityMs/personaTimeoutMs.
 * `provider` was removed in v8 to save space.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildEspStatus,
	isMeaningfulEvent,
	humanizeMeaningfulEvent,
	MEANINGFUL_EVENT_TYPES,
} from "../ui/server/server.js";

async function makeWorkspace() {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-esp-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await writeFile(
		join(dir, ".pi", "config.json"),
		JSON.stringify({ loop: { intervalSeconds: 60, personaInactivityMs: 600000, personaTimeoutMs: 3600000 } }),
		"utf8",
	);
	return dir;
}

async function writeJsonl(file, records) {
	await writeFile(file, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""), "utf8");
}

function runRecord(over = {}) {
	return {
		runId: "engineer-20260915-120000-aaaaaaaa",
		startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
		finishedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
		persona: "engineer",
		trigger: "loop",
		status: "ok",
		action: "ran",
		reason: "completed",
		...over,
	};
}

function eventRecord(over = {}) {
	return {
		version: 1,
		id: "evt-1",
		at: new Date().toISOString(),
		type: "git.push",
		persona: "engineer",
		runId: "engineer-20260915-120000-aaaaaaaa",
		data: { command: "git push origin feat/foo", kind: "git" },
		...over,
	};
}

test("meaningful set excludes heartbeats, includes GitHub side-effects", () => {
	assert.ok(MEANINGFUL_EVENT_TYPES.has("pr.merged"));
	assert.ok(MEANINGFUL_EVENT_TYPES.has("issue.created"));
	assert.ok(MEANINGFUL_EVENT_TYPES.has("git.push"));
	assert.ok(!isMeaningfulEvent({ type: "persona.spawned" }));
	assert.ok(!isMeaningfulEvent({ type: "loop.dispatch" }));
	assert.ok(!isMeaningfulEvent({ type: "llm.retry" }));
	assert.ok(!isMeaningfulEvent({ type: "git.status" }));
	assert.ok(isMeaningfulEvent({ type: "pr.merged" }));
});

test("humanizeMeaningfulEvent renders short ESP labels", () => {
	assert.equal(humanizeMeaningfulEvent({ type: "pr.merged", data: { command: "gh pr merge 12" } }), "merged PR #12");
	assert.equal(humanizeMeaningfulEvent({ type: "issue.created", data: {} }), "filed ticket");
	assert.equal(
		humanizeMeaningfulEvent({ type: "git.push", data: { command: "git push origin feat/foo" } }),
		"pushed feat/foo",
	);
	assert.ok(humanizeMeaningfulEvent({ type: "git.commit", data: {} }).length <= 40);
});

test("buildEspStatus reports last meaningful action + run_ok_n, no provider", async () => {
	const ws = await makeWorkspace();
	const runId = "engineer-20260915-120000-aaaaaaaa";
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [runRecord({ runId })]);
	const now = Date.now();
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), [
		eventRecord({ id: "e1", type: "loop.dispatch", at: new Date(now - 10 * 60 * 1000).toISOString(), runId: "", data: {} }),
		eventRecord({ id: "e2", type: "git.commit", at: new Date(now - 6 * 60 * 1000).toISOString(), runId, data: { command: "git commit -m wip", kind: "git" } }),
		eventRecord({ id: "e3", type: "git.push", at: new Date(now - 5 * 60 * 1000).toISOString(), runId, data: { command: "git push origin feat/foo", kind: "git" } }),
	]);
	await writeFile(join(ws, ".pi", "logs", "errors.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "usage.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.ok, true);
	assert.ok(!("provider" in payload), "provider removed in v8");
	assert.equal(payload.act_t, "git.push");
	assert.equal(payload.act, "pushed feat/foo");
	assert.equal(payload.run_id, runId);
	assert.equal(payload.run_ok_n, 2);
	assert.ok(payload.act_ago_s >= 0 && payload.act_ago_s <= 3600, `act_ago_s fresh, got ${payload.act_ago_s}`);
});

test("buildEspStatus marks stuck when active record exceeds timeout", async () => {
	const ws = await makeWorkspace();
	const runId = "engineer-20260915-100000-bbbbbbbb";
	// Started 2h ago (default timeout 1h) with no fresh events.
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [
		runRecord({
			runId,
			persona: "engineer",
			status: "started",
			action: "started",
			startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
			finishedAt: "",
		}),
	]);
	// Fake a live loop lock owned by this process so loop.running=true.
	await writeFile(
		join(ws, ".pi", "state", "loop.lock"),
		JSON.stringify({ version: 1, pid: process.pid, startedAt: new Date().toISOString(), workspace: ws }) + "\n",
		"utf8",
	);
	await writeFile(join(ws, ".pi", "logs", "events.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "errors.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "usage.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.stuck, true);
	assert.equal(payload.state, "stuck");
	assert.equal(payload.status, "red");
	assert.equal(payload.act_ago_s, -1);
	assert.equal(payload.run_ok_n, 0);
});

test("buildEspStatus finds model buried below the 100-row health window", async () => {
	const ws = await makeWorkspace();
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), []);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), []);
	await writeFile(join(ws, ".pi", "logs", "errors.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "usage.jsonl"), "", "utf8");
	// health.jsonl is oldest-first on disk: one old success carrying a model,
	// then 100 recent model-less retry entries that fill the fresh window.
	const rows = [{ ok: true, persona: "pm", runId: "r-old", model: "deepseek-ai/DeepSeek-V4-Flash-0731", reason: "ok" }];
	for (let i = 0; i < 100; i += 1) rows.push({ ok: false, persona: "pm", runId: "r", model: "", reason: "429 overloaded" });
	await writeJsonl(join(ws, ".pi", "logs", "health.jsonl"), rows);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.model, "deepseek-ai/DeepSeek-V4-Flash-0731");
});

test("buildEspStatus is green for fresh meaningful work without active persona", async () => {
	const ws = await makeWorkspace();
	const runId = "engineer-20260915-120000-cccccccc";
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [runRecord({ runId, status: "ok", action: "ran" })]);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), [
		eventRecord({ id: "e1", type: "pr.merged", at: new Date(Date.now() - 60 * 1000).toISOString(), runId, data: { command: "gh pr merge 12", kind: "gh" } }),
	]);
	await writeFile(join(ws, ".pi", "logs", "errors.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "usage.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");
	// Live loop lock so loop.running=true; last run finished so not activeP.
	await writeFile(
		join(ws, ".pi", "state", "loop.lock"),
		JSON.stringify({ version: 1, pid: process.pid, startedAt: new Date().toISOString(), workspace: ws }) + "\n",
		"utf8",
	);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.act, "merged PR #12");
	assert.equal(payload.status, "green");
	assert.equal(payload.stuck, false);
});
