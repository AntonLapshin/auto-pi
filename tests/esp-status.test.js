/**
 * esp-status v10 tests.
 *
 * Contract: the pocket monitor payload is trimmed to what the display shows
 * (proj/loop/stuck/llmActive/persona/model/lastAction/lastActionAgoS/
 * last10PersonaStatus/lastPersonaCallFinished persona-run history +
 * last10LlmStatus/lastLlmCallFinished true per-turn LLM history).
 * v9 `last10LlmStatus`/`lastLlmCallFinished` meant persona runs and were
 * renamed in v10; the v10 LLM fields come from `llm.jsonl`.
 * v8 fields (status/state/ok_n/fail_n/ run_id/run_ok_n/act/act_t/act_ago_s/
 * ago_s/last/tok_today/err/at) are gone.
 * `llmActive` is additive (old firmware ignores unknown fields).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildEspStatus,
	isMeaningfulEvent,
	isPersonaProcessAlive,
	humanizeMeaningfulEvent,
	MEANINGFUL_EVENT_TYPES,
} from "../ui/server/server.js";

const V10_KEYS = new Set([
	"ok",
	"proj",
	"loop",
	"stuck",
	"llmActive",
	"persona",
	"model",
	"lastAction",
	"lastActionAgoS",
	"last10PersonaStatus",
	"lastPersonaCallFinished",
	"last10LlmStatus",
	"lastLlmCallFinished",
]);

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

function healthRecord(over = {}) {
	return {
		version: 1,
		at: new Date().toISOString(),
		provider: "joingonka",
		model: "deepseek-ai/DeepSeek-V4-Flash-0731",
		runId: "r-1",
		persona: "engineer",
		ok: true,
		reason: "ok",
		...over,
	};
}

function llmRecord(over = {}) {
	return {
		version: 1,
		at: new Date().toISOString(),
		provider: "joingonka",
		model: "deepseek-ai/DeepSeek-V4-Flash-0731",
		runId: "r-1",
		persona: "engineer",
		ok: true,
		reason: "",
		...over,
	};
}

test("meaningful set excludes heartbeats, includes GitHub side-effects", () => {
	assert.ok(MEANINGFUL_EVENT_TYPES.has("pr.merged"));
	assert.ok(MEANINGFUL_EVENT_TYPES.has("issue.created"));
	assert.ok(MEANINGFUL_EVENT_TYPES.has("git.push"));
	assert.ok(MEANINGFUL_EVENT_TYPES.has("pr.edited"));
	assert.ok(MEANINGFUL_EVENT_TYPES.has("label.created"));
	assert.ok(!isMeaningfulEvent({ type: "persona.spawned" }));
	assert.ok(!isMeaningfulEvent({ type: "loop.dispatch" }));
	assert.ok(!isMeaningfulEvent({ type: "llm.retry" }));
	assert.ok(!isMeaningfulEvent({ type: "git.status" }));
	assert.ok(!isMeaningfulEvent({ type: "gh.command" }));
	assert.ok(isMeaningfulEvent({ type: "pr.merged" }));
	assert.ok(isMeaningfulEvent({ type: "pr.edited" }));
});

test("humanizeMeaningfulEvent renders short ESP labels", () => {
	assert.equal(humanizeMeaningfulEvent({ type: "pr.merged", data: { command: "gh pr merge 12" } }), "merged PR #12");
	assert.equal(humanizeMeaningfulEvent({ type: "issue.created", data: {} }), "filed ticket");
	assert.equal(
		humanizeMeaningfulEvent({ type: "git.push", data: { command: "git push origin feat/foo" } }),
		"pushed feat/foo",
	);
	assert.equal(humanizeMeaningfulEvent({ type: "git.push", data: { command: "git push", kind: "git" } }), "pushed");
	assert.equal(humanizeMeaningfulEvent({ type: "git.push", data: { command: "git push 2>&1", kind: "git" } }), "pushed");
	assert.equal(humanizeMeaningfulEvent({ type: "git.push", data: { command: "git push origin", kind: "git" } }), "pushed");
	assert.equal(
		humanizeMeaningfulEvent({ type: "git.push", data: { command: "git push origin --delete task/x 2>&1", kind: "git" } }),
		"deleted task/x",
	);
	assert.ok(humanizeMeaningfulEvent({ type: "git.commit", data: {} }).length <= 40);
	assert.equal(humanizeMeaningfulEvent({ type: "pr.edited", data: {} }), "edited PR");
	assert.equal(
		humanizeMeaningfulEvent({ type: "pr.edited", data: { command: "gh pr edit 110 --title X", kind: "gh" } }),
		"edited PR #110",
	);
	assert.equal(humanizeMeaningfulEvent({ type: "label.created", data: {} }), "created label");
});

test("buildEspStatus returns only the v10 fields", async () => {
	const ws = await makeWorkspace();
	const runId = "engineer-20260915-120000-aaaaaaaa";
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [runRecord({ runId })]);
	const now = Date.now();
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), [
		eventRecord({ id: "e1", type: "loop.dispatch", at: new Date(now - 10 * 60 * 1000).toISOString(), runId: "", data: {} }),
		eventRecord({ id: "e2", type: "git.commit", at: new Date(now - 6 * 60 * 1000).toISOString(), runId, data: { command: "git commit -m wip", kind: "git" } }),
		eventRecord({ id: "e3", type: "git.push", at: new Date(now - 5 * 60 * 1000).toISOString(), runId, data: { command: "git push origin feat/foo", kind: "git" } }),
	]);
	await writeJsonl(join(ws, ".pi", "logs", "health.jsonl"), [
		healthRecord({ ok: true, at: new Date(now - 60 * 1000).toISOString() }),
	]);
	await writeJsonl(join(ws, ".pi", "logs", "llm.jsonl"), [
		llmRecord({ ok: true, at: new Date(now - 30 * 1000).toISOString() }),
	]);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.ok, true);
	assert.deepEqual(new Set(Object.keys(payload)), V10_KEYS);
	assert.equal(payload.proj, "demo");
	assert.equal(typeof payload.loop, "boolean");
	assert.equal(typeof payload.stuck, "boolean");
	assert.equal(payload.persona, "engineer");
	assert.equal(payload.lastAction, "pushed feat/foo");
	assert.ok(payload.lastActionAgoS >= 0 && payload.lastActionAgoS <= 3600, `lastActionAgoS fresh, got ${payload.lastActionAgoS}`);
});

test("buildEspStatus reports last-10 persona-run outcomes newest-first + liveness", async () => {
	const ws = await makeWorkspace();
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), []);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), []);
	const now = Date.now();
	// health.jsonl is oldest-first on disk; readHealth flips to newest-first.
	const rows = [];
	for (let i = 0; i < 12; i += 1) {
		rows.push(healthRecord({
			ok: i % 3 !== 0, // pattern: F T T F T T ...
			at: new Date(now - (12 - i) * 60 * 1000).toISOString(),
		}));
	}
	// Newest record (last on disk): a failure 30s ago.
	rows.push(healthRecord({ ok: false, at: new Date(now - 30 * 1000).toISOString() }));
	await writeJsonl(join(ws, ".pi", "logs", "health.jsonl"), rows);
	await writeFile(join(ws, ".pi", "logs", "llm.jsonl"), "", "utf8");

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.last10PersonaStatus.length, 10);
	assert.ok(payload.last10PersonaStatus.every((v) => typeof v === "boolean"));
	assert.equal(payload.last10PersonaStatus[0], false); // newest first
	// Oldest-first disk rows reversed + head(10): newest 10 of the 13.
	const expected = rows.slice(-10).reverse().map((r) => r.ok);
	assert.deepEqual(payload.last10PersonaStatus, expected);
	assert.ok(payload.lastPersonaCallFinished >= 0 && payload.lastPersonaCallFinished <= 120, `fresh, got ${payload.lastPersonaCallFinished}`);
	// No llm.jsonl rows yet -> empty true-LLM bars + unknown LLM liveness.
	assert.deepEqual(payload.last10LlmStatus, []);
	assert.equal(payload.lastLlmCallFinished, -1);
	// No meaningful events yet.
	assert.equal(payload.lastAction, "-");
	assert.equal(payload.lastActionAgoS, -1);
	// No records at all -> empty bars + unknown liveness on both scales.
	const ws2 = await makeWorkspace();
	await writeJsonl(join(ws2, ".pi", "logs", "runs.jsonl"), []);
	await writeJsonl(join(ws2, ".pi", "logs", "events.jsonl"), []);
	await writeFile(join(ws2, ".pi", "logs", "health.jsonl"), "", "utf8");
	await writeFile(join(ws2, ".pi", "logs", "llm.jsonl"), "", "utf8");
	const empty = await buildEspStatus({ workspace: ws2, projectName: "demo" });
	assert.deepEqual(empty.last10PersonaStatus, []);
	assert.equal(empty.lastPersonaCallFinished, -1);
	assert.deepEqual(empty.last10LlmStatus, []);
	assert.equal(empty.lastLlmCallFinished, -1);
});

test("buildEspStatus reports last-10 true LLM turns newest-first + liveness", async () => {
	const ws = await makeWorkspace();
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), []);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), []);
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");
	const now = Date.now();
	// llm.jsonl is oldest-first on disk; readLlmCalls flips to newest-first.
	const rows = [];
	for (let i = 0; i < 12; i += 1) {
		rows.push(llmRecord({
			ok: i % 2 === 0,
			at: new Date(now - (12 - i) * 30 * 1000).toISOString(),
		}));
	}
	rows.push(llmRecord({ ok: true, at: new Date(now - 10 * 1000).toISOString() }));
	await writeJsonl(join(ws, ".pi", "logs", "llm.jsonl"), rows);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.last10LlmStatus.length, 10);
	assert.equal(payload.last10LlmStatus[0], true); // newest first
	const expected = rows.slice(-10).reverse().map((r) => r.ok);
	assert.deepEqual(payload.last10LlmStatus, expected);
	assert.ok(payload.lastLlmCallFinished >= 0 && payload.lastLlmCallFinished <= 120, `fresh, got ${payload.lastLlmCallFinished}`);
	// Persona scale stays empty when only LLM turns exist.
	assert.deepEqual(payload.last10PersonaStatus, []);
	assert.equal(payload.lastPersonaCallFinished, -1);
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
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), []);
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.stuck, true);
	assert.equal(payload.lastAction, "-");
	assert.equal(payload.lastActionAgoS, -1);
});

test("buildEspStatus is not stuck while the persona child is alive (in-flight persona run)", async () => {
	const ws = await makeWorkspace();
	const now = Date.now();
	const runId = "engineer-20260916-140000-aaaaaaaa";
	// Active run started 20m ago (within the 1h wall-clock cap) with ledgers
	// silent for 15m (past the 10m watchdog): health/events are only written
	// when a persona run finishes or retries, so a live `pi` child means an
	// in-flight run — actively working, not stuck.
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [
		runRecord({
			runId,
			status: "started",
			action: "started",
			startedAt: new Date(now - 20 * 60 * 1000).toISOString(),
			finishedAt: "",
		}),
	]);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), [
		eventRecord({ id: "e1", type: "persona.spawned", at: new Date(now - 15 * 60 * 1000).toISOString(), runId, data: {} }),
	]);
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");
	await writeFile(
		join(ws, ".pi", "state", "loop.lock"),
		JSON.stringify({ version: 1, pid: process.pid, startedAt: new Date().toISOString(), workspace: ws }) + "\n",
		"utf8",
	);

	const alive = await buildEspStatus({ workspace: ws, projectName: "demo" }, { isPersonaAlive: async () => true });
	assert.equal(alive.stuck, false);
	assert.equal(alive.llmActive, true);

	// Same silence with NO live child: the loop is wedged — stuck.
	const dead = await buildEspStatus({ workspace: ws, projectName: "demo" }, { isPersonaAlive: async () => false });
	assert.equal(dead.stuck, true);
	assert.equal(dead.llmActive, false);
});

test("buildEspStatus treats recent (failed) persona runs as activity", async () => {
	const ws = await makeWorkspace();
	const now = Date.now();
	const runId = "engineer-20260916-140000-bbbbbbbb";
	// Active run 20m old, events silent 30m, but a failed health record 1m ago
	// (an unsuccessful persona run / retry) proves the persona is working.
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [
		runRecord({
			runId,
			status: "started",
			action: "started",
			startedAt: new Date(now - 20 * 60 * 1000).toISOString(),
			finishedAt: "",
		}),
	]);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), [
		eventRecord({ id: "e1", type: "persona.spawned", at: new Date(now - 30 * 60 * 1000).toISOString(), runId, data: {} }),
	]);
	await writeJsonl(join(ws, ".pi", "logs", "health.jsonl"), [
		healthRecord({ ok: false, runId, at: new Date(now - 60 * 1000).toISOString() }),
	]);
	await writeFile(join(ws, ".pi", "logs", "llm.jsonl"), "", "utf8");
	await writeFile(
		join(ws, ".pi", "state", "loop.lock"),
		JSON.stringify({ version: 1, pid: process.pid, startedAt: new Date().toISOString(), workspace: ws }) + "\n",
		"utf8",
	);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" }, { isPersonaAlive: async () => false });
	assert.equal(payload.stuck, false);
	assert.equal(payload.lastPersonaCallFinished >= 0 && payload.lastPersonaCallFinished <= 120, true);
});

test("buildEspStatus treats recent LLM turns as activity", async () => {
	const ws = await makeWorkspace();
	const now = Date.now();
	const runId = "engineer-20260916-140000-cccccccc";
	// Active run 20m old, events + health silent 30m, but a failed LLM turn
	// 1m ago proves the provider is being hit.
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), [
		runRecord({
			runId,
			status: "started",
			action: "started",
			startedAt: new Date(now - 20 * 60 * 1000).toISOString(),
			finishedAt: "",
		}),
	]);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), [
		eventRecord({ id: "e1", type: "persona.spawned", at: new Date(now - 30 * 60 * 1000).toISOString(), runId, data: {} }),
	]);
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");
	await writeJsonl(join(ws, ".pi", "logs", "llm.jsonl"), [
		llmRecord({ ok: false, runId, at: new Date(now - 60 * 1000).toISOString(), reason: "429 overloaded" }),
	]);
	await writeFile(
		join(ws, ".pi", "state", "loop.lock"),
		JSON.stringify({ version: 1, pid: process.pid, startedAt: new Date().toISOString(), workspace: ws }) + "\n",
		"utf8",
	);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" }, { isPersonaAlive: async () => false });
	assert.equal(payload.stuck, false);
	assert.equal(payload.lastLlmCallFinished >= 0 && payload.lastLlmCallFinished <= 120, true);
});

test("humanizeMeaningfulEvent uses the explicit PR number for gh pr create", () => {
	// `gh pr create` commands carry no number, so the event data must supply
	// it — otherwise the display shows a numberless "opened PR".
	assert.equal(
		humanizeMeaningfulEvent({ type: "pr.created", data: { command: "gh pr create --base main --head task/x", kind: "gh", prNumber: 101 } }),
		"opened PR #101",
	);
});

test("isPersonaProcessAlive ignores redacted/empty run IDs without scanning", async () => {
	assert.equal(await isPersonaProcessAlive("[REDACTED]"), false);
	assert.equal(await isPersonaProcessAlive(""), false);
	assert.equal(await isPersonaProcessAlive(null), false);
});

test("buildEspStatus finds model buried below the 100-row health window", async () => {
	const ws = await makeWorkspace();
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), []);
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), []);
	// health.jsonl is oldest-first on disk: one old success carrying a model,
	// then 100 recent model-less retry entries that fill the fresh window.
	const rows = [{ ok: true, persona: "pm", runId: "r-old", model: "deepseek-ai/DeepSeek-V4-Flash-0731", reason: "ok" }];
	for (let i = 0; i < 100; i += 1) rows.push({ ok: false, persona: "pm", runId: "r", model: "", reason: "429 overloaded" });
	await writeJsonl(join(ws, ".pi", "logs", "health.jsonl"), rows);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.model, "deepseek-ai/DeepSeek-V4-Flash-0731");
});

test("buildEspStatus finds lastAction buried below 200 heartbeat rows", async () => {
	// Regression: heartbeats (`loop.dispatch` every cycle, `llm.retry` during
	// a provider outage, read-only `gh pr view` probes) bury real GitHub
	// actions within hours. A 200-row scan window stuck the display on
	// "no action yet" (`-`) for days despite fresh pushes.
	const ws = await makeWorkspace();
	await writeJsonl(join(ws, ".pi", "logs", "runs.jsonl"), []);
	await writeFile(join(ws, ".pi", "logs", "health.jsonl"), "", "utf8");
	await writeFile(join(ws, ".pi", "logs", "llm.jsonl"), "", "utf8");
	const now = Date.now();
	const rows = [
		eventRecord({
			id: "e-old",
			type: "git.push",
			at: new Date(now - 19 * 60 * 60 * 1000).toISOString(),
			data: { command: "git push origin feat/foo", kind: "git" },
		}),
	];
	for (let i = 0; i < 300; i += 1) {
		rows.push(eventRecord({
			id: `h-${i}`,
			type: "loop.dispatch",
			at: new Date(now - (300 - i) * 60 * 1000).toISOString(),
			runId: "",
			data: {},
		}));
	}
	await writeJsonl(join(ws, ".pi", "logs", "events.jsonl"), rows);

	const payload = await buildEspStatus({ workspace: ws, projectName: "demo" });
	assert.equal(payload.lastAction, "pushed feat/foo");
	assert.ok(payload.lastActionAgoS >= 19 * 3600 && payload.lastActionAgoS < 20 * 3600, `stale but present, got ${payload.lastActionAgoS}`);
});
