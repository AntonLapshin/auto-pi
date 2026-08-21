/**
 * M13 persona-retry tests.
 *
 * Covers the retry/backoff wrapper around the persona (LLM) invocation that
 * keeps the loop alive when an unstable provider fails a single command:
 *   - retryability classification (`isRetryablePersonaFailure`)
 *   - config-driven retry settings (`personaRetrySettings`)
 *   - the retry loop (`runPersonaWithRetry`) — success, transient retry,
 *     give-up after maxRetries, no-retry on non-transient errors, and that
 *     only the final result is written to the run ledger
 *   - argument building (`buildPersonaArgs`)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isRetryablePersonaFailure,
	personaRetrySettings,
	runPersonaWithRetry,
	buildPersonaArgs,
	loadPersonaPromptSync,
	DEFAULT_PERSONA_MAX_RETRIES,
	DEFAULT_PERSONA_RETRY_BASE_DELAY_MS,
	DEFAULT_PERSONA_RETRY_MAX_DELAY_MS,
} from "../extensions/loop/persona-runner.js";

// --- retryability classification ---

test("isRetryablePersonaFailure: true for network/timeout/5xx/rate-limit", () => {
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "connection refused" }), true);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "request timed out" }), true);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "502 Bad Gateway" }), true);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "API rate limit exceeded" }), true);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "ECONNRESET" }), true);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "insufficient_quota" }), true);
});

test("isRetryablePersonaFailure: true for empty output with non-zero exit", () => {
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "" }), true);
});

test("isRetryablePersonaFailure: true when process failed to spawn (no exit code)", () => {
	assert.equal(isRetryablePersonaFailure({ exitCode: null, stdout: "", stderr: "spawn pi ENOENT" }), true);
	assert.equal(isRetryablePersonaFailure({ exitCode: undefined, stdout: "", stderr: "" }), true);
});

test("isRetryablePersonaFailure: false for non-transient failures", () => {
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "not found" }), false);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "invalid config" }), false);
	assert.equal(isRetryablePersonaFailure({ exitCode: 1, stdout: "", stderr: "authentication failed" }), false);
});

test("isRetryablePersonaFailure: false on success", () => {
	assert.equal(isRetryablePersonaFailure({ exitCode: 0, stdout: "ok", stderr: "" }), false);
});

// --- retry settings ---

test("personaRetrySettings applies defaults", () => {
	const s = personaRetrySettings({});
	assert.equal(s.maxRetries, DEFAULT_PERSONA_MAX_RETRIES);
	assert.equal(s.baseDelayMs, DEFAULT_PERSONA_RETRY_BASE_DELAY_MS);
	assert.equal(s.maxDelayMs, DEFAULT_PERSONA_RETRY_MAX_DELAY_MS);
});

test("personaRetrySettings reads config overrides", () => {
	const s = personaRetrySettings({ pi: { maxRetries: 5, retryBaseDelayMs: 100, retryMaxDelayMs: 1000 } });
	assert.equal(s.maxRetries, 5);
	assert.equal(s.baseDelayMs, 100);
	assert.equal(s.maxDelayMs, 1000);
});

test("personaRetrySettings allows maxRetries=0 (disable retry)", () => {
	const s = personaRetrySettings({ pi: { maxRetries: 0 } });
	assert.equal(s.maxRetries, 0);
});

// --- buildPersonaArgs ---

test("buildPersonaArgs includes persona flags and model/provider, and does NOT pass unsupported token-cap flags", async () => {
	const args = buildPersonaArgs({
		persona: "engineer",
		runId: "engineer-1",
		contextFile: "/tmp/ctx.md",
		config: {
			pi: { provider: "openai", model: "gpt-4o" },
			limits: { maxPromptTokensPerPersona: 1000, maxOutputTokensPerPersona: 500 },
		},
	});
	assert.ok(args.includes("-p"));
	assert.ok(args.includes("--no-session"));
	assert.ok(args.includes("--name"));
	assert.ok(args.includes("engineer-1"));
	assert.ok(args.includes("--provider"));
	assert.ok(args.includes("openai"));
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("gpt-4o"));
	// pi does NOT support these options and hard-errors on unknown flags, so the
	// per-persona token-cap flags must NOT be passed (guardrails stay loop-level).
	assert.ok(!args.includes("--max-prompt"));
	assert.ok(!args.includes("--max-output"));
	assert.ok(!args.includes("--max-context"));
	// The boot URL-hang guard: web/browse-fetch tools are excluded so the model
	// never auto-fetches URLs in the context (which hangs the batch run).
	assert.ok(args.includes("--exclude-tools"));
	// The persona prompt is appended to the system prompt.
	assert.ok(args.includes("--append-system-prompt"));
	assert.ok(args.includes("/tmp/ctx.md"));
});

test("loadPersonaPromptSync falls back to built-in prompt", () => {
	const p = loadPersonaPromptSync("nonexistent-persona");
	assert.match(p, /persona in the auto-pi autonomous engineering team/);
});

// --- runPersonaWithRetry ---

/** Build a minimal workspace with a config + run dir. */
async function makeWorkspace() {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-retry-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	await mkdir(join(dir, ".pi", "runs"), { recursive: true });
	return dir;
}

/** Read the runs.jsonl ledger lines (filtering out blanks / non-JSON). */
async function readLedger(workspace) {
	try {
		const raw = await readFile(join(workspace, ".pi", "logs", "runs.jsonl"), "utf8");
		return raw.split("\n").filter((l) => l.trim()).map((l) => {
			try { return JSON.parse(l); } catch { return null; }
		}).filter(Boolean);
	} catch {
		return [];
	}
}

const baseOpts = (workspace, execute) => ({
	workspace,
	persona: "engineer",
	runId: "engineer-test-1",
	contextFile: join(workspace, "ctx.md"),
	config: { pi: { maxRetries: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 5 } },
	execute,
});

test("runPersonaWithRetry: succeeds on first attempt (no retry)", async () => {
	const dir = await makeWorkspace();
	await writeFile(join(dir, "ctx.md"), "ctx", "utf8");
	let calls = 0;
	const execute = async () => {
		calls += 1;
		return { exitCode: 0, stdout: "tokens: { input: 10, output: 5 }", stderr: "" };
	};
	const res = await runPersonaWithRetry(baseOpts(dir, execute));
	assert.equal(res.ok, true);
	assert.equal(calls, 1);
	assert.equal(res.retries, 0);
	assert.equal(res.retryable, false);
	// Exactly one run record (final result only).
	const ledger = await readLedger(dir);
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].status, "ok");
});

test("runPersonaWithRetry: retries a transient failure then succeeds", async () => {
	const dir = await makeWorkspace();
	await writeFile(join(dir, "ctx.md"), "ctx", "utf8");
	let calls = 0;
	const retries = [];
	const execute = async () => {
		calls += 1;
		if (calls === 1) return { exitCode: 1, stdout: "", stderr: "connection refused" };
		return { exitCode: 0, stdout: "done", stderr: "" };
	};
	const res = await runPersonaWithRetry({
		...baseOpts(dir, execute),
		onRetry: (info) => retries.push(info),
	});
	assert.equal(res.ok, true);
	assert.equal(calls, 2);
	assert.equal(res.retries, 1);
	// onRetry was called with attempt/reason/delay.
	assert.equal(retries.length, 1);
	assert.equal(retries[0].attempt, 1);
	assert.match(retries[0].reason, /connection refused/);
	assert.ok(retries[0].delayMs >= 0);
	// Only the final (successful) result is recorded — one ledger line.
	const ledger = await readLedger(dir);
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].status, "ok");
});

test("runPersonaWithRetry: gives up after maxRetries on persistent transient failure", async () => {
	const dir = await makeWorkspace();
	await writeFile(join(dir, "ctx.md"), "ctx", "utf8");
	let calls = 0;
	const execute = async () => {
		calls += 1;
		return { exitCode: 1, stdout: "", stderr: "network error" };
	};
	const res = await runPersonaWithRetry(baseOpts(dir, execute));
	assert.equal(res.ok, false);
	// 1 initial + maxRetries(2) retries = 3 calls.
	assert.equal(calls, 3);
	assert.equal(res.retries, 2);
	assert.equal(res.retryable, true);
	// The final failure is recorded once.
	const ledger = await readLedger(dir);
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].status, "error");
});

test("runPersonaWithRetry: does not retry non-transient failures", async () => {
	const dir = await makeWorkspace();
	await writeFile(join(dir, "ctx.md"), "ctx", "utf8");
	let calls = 0;
	const execute = async () => {
		calls += 1;
		return { exitCode: 1, stdout: "", stderr: "invalid config" };
	};
	const res = await runPersonaWithRetry(baseOpts(dir, execute));
	assert.equal(res.ok, false);
	assert.equal(calls, 1);
	assert.equal(res.retries, 0);
	assert.equal(res.retryable, false);
});

test("runPersonaWithRetry: maxRetries=0 disables retry entirely", async () => {
	const dir = await makeWorkspace();
	await writeFile(join(dir, "ctx.md"), "ctx", "utf8");
	let calls = 0;
	const execute = async () => {
		calls += 1;
		return { exitCode: 1, stdout: "", stderr: "network error" };
	};
	const res = await runPersonaWithRetry({
		...baseOpts(dir, execute),
		config: { pi: { maxRetries: 0 } },
	});
	assert.equal(res.ok, false);
	assert.equal(calls, 1);
	assert.equal(res.retries, 0);
});

test("runPersonaWithRetry: writes stdout/stderr to the run dir", async () => {
	const dir = await makeWorkspace();
	await writeFile(join(dir, "ctx.md"), "ctx", "utf8");
	const execute = async () => ({ exitCode: 0, stdout: "hello", stderr: "" });
	const res = await runPersonaWithRetry(baseOpts(dir, execute));
	const runDir = join(dir, ".pi", "runs", "engineer-test-1");
	await access(join(runDir, "stdout.txt"));
	const out = await readFile(join(runDir, "stdout.txt"), "utf8");
	assert.equal(out, "hello");
	assert.ok(res.runDir);
});
