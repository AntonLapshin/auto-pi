/**
 * Tests for the `/loop-provider` config read/update helper
 * (`extensions/loop/provider-config.js`).
 *
 * Covers reading the provider/model the loop is configured to use, persisting a
 * new provider/model into `.pi/config.json` while preserving every other
 * section, and the no-op path when nothing changes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	readConfiguredProviderModel,
	writeProviderModel,
} from "../extensions/loop/provider-config.js";

/** Build a minimal but realistic project config. */
function sampleConfig(overrides = {}) {
	return {
		project: { name: "demo", repo: "demo", owner: "me", ownerEmail: "", defaultBranch: "main", demoUrl: "" },
		pi: { provider: "joingonka", model: "deepseek-ai/DeepSeek-V4-Flash-0731", contextMaxTokens: 150000, maxRetries: 2, retryBaseDelayMs: 5000, retryMaxDelayMs: 30000 },
		loop: { intervalSeconds: 60, stopOnBudgetExceeded: true, maxConsecutiveFailures: 3 },
		limits: { maxBatchIssues: 3, maxIssueAttempts: 3, maxTokensPerCycle: 250000, maxTokensPerDay: 750000, maxCostPerDayUsd: 20, maxPromptTokensPerPersona: 135000, maxOutputTokensPerPersona: 8000 },
		github: { autoCreateRepo: true, repoVisibility: "public" },
		stack: { framework: "react", typescript: true, tailwind: true, testRunner: "vitest" },
		quality: { coreCoveragePercent: 100, featureBranches: true },
		review: { reviewerCanPushTestCommits: false },
		pages: { enabled: true, deployBranch: "gh-pages" },
		notifications: { telegram: { enabled: false } },
		logging: { maxFileSizeMb: 10, rotate: true },
		...overrides,
	};
}

/** Create a temp workspace with a `.pi/config.json` and return its path. */
async function makeWorkspace(config = sampleConfig()) {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-provider-"));
	const piDir = join(dir, ".pi");
	await mkdir(piDir, { recursive: true });
	await writeFile(join(piDir, "config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
	return dir;
}

test("readConfiguredProviderModel returns the configured provider/model", async () => {
	const ws = await makeWorkspace();
	const res = await readConfiguredProviderModel(ws);
	assert.equal(res.ok, true);
	assert.equal(res.provider, "joingonka");
	assert.equal(res.model, "deepseek-ai/DeepSeek-V4-Flash-0731");
	await rm(ws, { recursive: true, force: true });
});

test("readConfiguredProviderModel tolerates a missing config (returns error)", async () => {
	const ws = await mkdtemp(join(tmpdir(), "auto-pi-provider-empty-"));
	const res = await readConfiguredProviderModel(ws);
	assert.equal(res.ok, false);
	assert.match(res.error, /Cannot read/);
	await rm(ws, { recursive: true, force: true });
});

test("writeProviderModel persists new provider/model and preserves other sections", async () => {
	const ws = await makeWorkspace();
	const res = await writeProviderModel(ws, {
		provider: "gonkaapi",
		model: "moonshotai/Kimi-K2.6",
	});
	assert.equal(res.ok, true);
	assert.deepEqual(res.changed.sort(), ["model", "provider"].sort());

	const raw = JSON.parse(await readFile(join(ws, ".pi", "config.json"), "utf8"));
	assert.equal(raw.pi.provider, "gonkaapi");
	assert.equal(raw.pi.model, "moonshotai/Kimi-K2.6");
	// Other sections untouched.
	assert.equal(raw.project.name, "demo");
	assert.equal(raw.loop.intervalSeconds, 60);
	assert.equal(raw.limits.maxTokensPerDay, 750000);
	assert.equal(raw.pages.enabled, true);
	await rm(ws, { recursive: true, force: true });
});

test("writeProviderModel with same values reports no change and does not rewrite", async () => {
	const ws = await makeWorkspace();
	const before = await readFile(join(ws, ".pi", "config.json"), "utf8");
	const res = await writeProviderModel(ws, {
		provider: "joingonka",
		model: "deepseek-ai/DeepSeek-V4-Flash-0731",
	});
	assert.equal(res.ok, true);
	assert.deepEqual(res.changed, []);
	const after = await readFile(join(ws, ".pi", "config.json"), "utf8");
	assert.equal(after, before); // untouched
	await rm(ws, { recursive: true, force: true });
});

test("writeProviderModel creates the pi section when absent", async () => {
	const ws = await makeWorkspace({ project: { name: "x", repo: "x", owner: "me" } });
	const res = await writeProviderModel(ws, { provider: "joingonka", model: "m" });
	assert.equal(res.ok, true);
	const raw = JSON.parse(await readFile(join(ws, ".pi", "config.json"), "utf8"));
	assert.equal(raw.pi.provider, "joingonka");
	assert.equal(raw.pi.model, "m");
	await rm(ws, { recursive: true, force: true });
});
