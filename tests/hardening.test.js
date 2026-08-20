/**
 * M13 hardening tests.
 *
 * Covers the reliability measures (retry/backoff, rate-limit handling, stale
 * branch cleanup, conflict detection, issue-attempt limits), the budget guard
 * (per-cycle/per-day/cost limits + consecutive-failure limit + per-persona
 * token caps), config validation, and the new commands (`/loop-status`, `/loop-logs`,
 * `/loop-resume`, `/loop-sync-config`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- github retry/backoff ---

import {
	createGhClient,
	backoffDelay,
	parseRateLimitReset,
	DEFAULT_MAX_RETRIES,
} from "../skills/github/core.js";

test("gh client returns success immediately without retry", async () => {
	let calls = 0;
	const runner = async () => {
		calls += 1;
		return { ok: true, stdout: "[]", stderr: "", exitCode: 0 };
	};
	const gh = createGhClient({ runner, maxRetries: 3 });
	const res = await gh(["issue", "list"]);
	assert.equal(res.ok, true);
	assert.equal(calls, 1);
});

test("gh client retries transient failures and succeeds", async () => {
	let calls = 0;
	const runner = async () => {
		calls += 1;
		if (calls === 1) return { ok: false, stdout: "", stderr: "connection refused", exitCode: 1 };
		return { ok: true, stdout: "[]", stderr: "", exitCode: 0 };
	};
	const gh = createGhClient({ runner, maxRetries: 3, baseDelayMs: 1 });
	const res = await gh(["issue", "list"]);
	assert.equal(res.ok, true);
	assert.equal(calls, 2);
});

test("gh client gives up after maxRetries on persistent failure", async () => {
	let calls = 0;
	const runner = async () => {
		calls += 1;
		return { ok: false, stdout: "", stderr: "connection refused", exitCode: 1 };
	};
	const gh = createGhClient({ runner, maxRetries: 2, baseDelayMs: 1 });
	const res = await gh(["issue", "list"]);
	assert.equal(res.ok, false);
	assert.equal(calls, 3); // 1 initial + 2 retries
});

test("gh client does not retry non-transient errors", async () => {
	let calls = 0;
	const runner = async () => {
		calls += 1;
		return { ok: false, stdout: "", stderr: "not found", exitCode: 1 };
	};
	const gh = createGhClient({ runner, maxRetries: 3, baseDelayMs: 1 });
	const res = await gh(["issue", "list"]);
	assert.equal(res.ok, false);
	assert.equal(calls, 1);
});

test("gh client backs off on rate limit and retries", async () => {
	let calls = 0;
	const runner = async () => {
		calls += 1;
		if (calls === 1) return { ok: false, stdout: "", stderr: "API rate limit exceeded", exitCode: 1 };
		return { ok: true, stdout: "[]", stderr: "", exitCode: 0 };
	};
	const gh = createGhClient({ runner, maxRetries: 3, baseDelayMs: 1 });
	const res = await gh(["issue", "list"], { rateLimitReset: String(Math.floor(Date.now() / 1000) + 5) });
	assert.equal(res.ok, true);
	assert.equal(calls, 2);
});

test("parseRateLimitReset converts epoch seconds to ms", () => {
	assert.equal(parseRateLimitReset("1700000000"), 1700000000000);
	assert.equal(parseRateLimitReset(""), 0);
	assert.equal(parseRateLimitReset("abc"), 0);
});

test("backoffDelay returns a bounded value with jitter", () => {
	for (let i = 0; i < 50; i++) {
		const d = backoffDelay(1, { baseDelayMs: 1000, maxDelayMs: 30000 });
		assert.ok(d >= 0 && d <= 30000, `delay ${d} within bounds`);
	}
	// attempt 0 → base*2^0 = base
	const d0 = backoffDelay(0, { baseDelayMs: 1000, maxDelayMs: 30000 });
	assert.ok(d0 >= 0 && d0 <= 1000);
});

// --- budget guard ---

import {
	checkBudget,
	checkCycleBudget,
	checkConsecutiveFailures,
	budgetLimits,
	personaTokenFlags,
	DEFAULT_MAX_TOKENS_PER_DAY,
	DEFAULT_MAX_TOKENS_PER_CYCLE,
	DEFAULT_MAX_CONSECUTIVE_FAILURES,
} from "../skills/budget-guard/core.js";

test("budgetLimits applies defaults", () => {
	const l = budgetLimits({});
	assert.equal(l.maxTokensPerDay, DEFAULT_MAX_TOKENS_PER_DAY);
	assert.equal(l.maxTokensPerCycle, DEFAULT_MAX_TOKENS_PER_CYCLE);
	assert.equal(l.maxConsecutiveFailures, DEFAULT_MAX_CONSECUTIVE_FAILURES);
	assert.equal(l.contextMaxTokens, 150000);
	assert.equal(l.maxPromptTokensPerPersona, 135000);
	assert.equal(l.maxOutputTokensPerPersona, 8000);
});

test("budgetLimits reads config overrides", () => {
	const l = budgetLimits({
		limits: { maxTokensPerDay: 1000, maxCostPerDayUsd: 5, maxIssueAttempts: 2 },
		loop: { maxConsecutiveFailures: 5 },
		pi: { contextMaxTokens: 120000 },
	});
	assert.equal(l.maxTokensPerDay, 1000);
	assert.equal(l.maxCostPerDayUsd, 5);
	assert.equal(l.maxConsecutiveFailures, 5);
	assert.equal(l.contextMaxTokens, 120000);
});

test("checkBudget flags day/cost overruns", () => {
	assert.equal(checkBudget({ limits: { maxTokensPerDay: 1000 } }, { tokensUsed: 500, costUsd: 0 }).exceeded, false);
	assert.equal(checkBudget({ limits: { maxTokensPerDay: 1000 } }, { tokensUsed: 1500, costUsd: 0 }).exceeded, true);
	assert.equal(checkBudget({ limits: { maxCostPerDayUsd: 5 } }, { tokensUsed: 0, costUsd: 6 }).exceeded, true);
});

test("checkCycleBudget flags per-cycle overrun", () => {
	assert.equal(checkCycleBudget({ limits: { maxTokensPerCycle: 1000 } }, 500).exceeded, false);
	assert.equal(checkCycleBudget({ limits: { maxTokensPerCycle: 1000 } }, 1500).exceeded, true);
});

test("checkConsecutiveFailures flags repeated failures", () => {
	assert.equal(checkConsecutiveFailures({ loop: { maxConsecutiveFailures: 3 } }, 2).exceeded, false);
	const r = checkConsecutiveFailures({ loop: { maxConsecutiveFailures: 3 } }, 3);
	assert.equal(r.exceeded, true);
	assert.match(r.reason, /repeated failures/);
});

test("personaTokenFlags builds pi token-cap flags", () => {
	const flags = personaTokenFlags({});
	assert.deepEqual(flags, ["--max-context", "150000", "--max-prompt", "135000", "--max-output", "8000"]);
});

// --- config validation ---

import {
	validateConfig,
	syncConfig,
	loadDefaultConfig,
	readProjectConfig,
} from "../skills/config/core.js";

test("validateConfig accepts a valid seed-generated config", async () => {
	const defaults = await loadDefaultConfig();
	const cfg = { ...defaults, project: { name: "App", repo: "app", owner: "octocat", defaultBranch: "main", demoUrl: "", ownerEmail: "" } };
	const res = validateConfig(cfg);
	assert.equal(res.ok, true, `errors: ${res.errors.join("; ")}`);
});

test("validateConfig rejects invalid values", () => {
	const bad = {
		project: { name: "App", repo: "app", owner: "octocat" },
		loop: { intervalSeconds: 1 }, // < 5
		limits: { maxTokensPerDay: 0 }, // < 1
		github: { repoVisibility: "sponsored" }, // invalid enum
		stack: { framework: "vue" }, // not react
		quality: { coreCoveragePercent: 150 }, // > 100
		logging: { maxFileSizeMb: 0 }, // < 1
	};
	const res = validateConfig(bad);
	assert.equal(res.ok, false);
	assert.ok(res.errors.length >= 6, `got ${res.errors.length} errors`);
	assert.ok(res.errors.some((e) => /intervalSeconds/.test(e)));
	assert.ok(res.errors.some((e) => /repoVisibility/.test(e)));
	assert.ok(res.errors.some((e) => /coreCoveragePercent/.test(e)));
});

test("validateConfig is lenient about missing optional project fields", () => {
	const res = validateConfig({ project: { owner: "o", repo: "r" } });
	assert.equal(res.ok, true);
});

test("syncConfig preserves project identity while applying defaults", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-sync-"));
	await mkdir(join(dir, ".pi"), { recursive: true });
	await writeFile(
		join(dir, ".pi", "config.json"),
		JSON.stringify({
			project: { name: "My App", repo: "my-app", owner: "octocat", ownerEmail: "o@x.com", defaultBranch: "main", demoUrl: "https://octocat.github.io/my-app/" },
			loop: { intervalSeconds: 30 },
			custom: { extra: "keep-me" },
		}),
		"utf8",
	);
	const res = await syncConfig(dir);
	assert.equal(res.ok, true, res.error);
	// Project identity preserved.
	assert.equal(res.config.project.name, "My App");
	assert.equal(res.config.project.repo, "my-app");
	assert.equal(res.config.project.owner, "octocat");
	assert.equal(res.config.custom.extra, "keep-me");
	// Defaults applied (e.g. limits from the default config).
	assert.ok(res.config.limits?.maxTokensPerDay, "default limits present after sync");
	assert.ok(res.config.logging?.maxFileSizeMb, "default logging present after sync");
	// The on-disk file was updated.
	const onDisk = JSON.parse(await readFile(join(dir, ".pi", "config.json"), "utf8"));
	assert.equal(onDisk.project.name, "My App");
	assert.ok(onDisk.limits, "defaults written to disk");
});

test("readProjectConfig reads a project config", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-rpc-"));
	await mkdir(join(dir, ".pi"), { recursive: true });
	await writeFile(join(dir, ".pi", "config.json"), JSON.stringify({ project: { name: "A" } }), "utf8");
	const res = await readProjectConfig(dir);
	assert.equal(res.ok, true);
	assert.equal(res.config.project.name, "A");
});

// --- reliability ---

import {
	cleanupStaleBranches,
	detectAndLabelConflicts,
	countIssueAttempts,
	enforceIssueAttemptLimit,
	runReliabilityChecks,
} from "../extensions/loop/reliability.js";

function okGh() {
	return async (args) => {
		const cmd = args.join(" ");
		if (cmd.startsWith("pr list --repo o/r --state merged")) {
			return { ok: true, stdout: JSON.stringify([{ number: 1, headRefName: "task/1-foo", mergedAt: "t" }]), stderr: "", exitCode: 0 };
		}
		if (cmd.includes("git/refs/heads/")) {
			return { ok: true, stdout: "", stderr: "", exitCode: 0 };
		}
		if (cmd.startsWith("pr list --repo o/r --state open")) {
			return { ok: true, stdout: JSON.stringify([{ number: 2, mergeable: "CONFLICTING", labels: [{ name: "pi:ready" }], headRefName: "task/2-bar" }]), stderr: "", exitCode: 0 };
		}
		if (cmd.startsWith("pr edit")) {
			return { ok: true, stdout: "", stderr: "", exitCode: 0 };
		}
		if (cmd.startsWith("pr list --repo o/r --state all")) {
			return { ok: true, stdout: JSON.stringify([{ number: 3, body: "Closes #5", state: "closed" }]), stderr: "", exitCode: 0 };
		}
		if (cmd.startsWith("issue edit")) {
			return { ok: true, stdout: "", stderr: "", exitCode: 0 };
		}
		return { ok: false, stdout: "", stderr: "unexpected: " + cmd, exitCode: 1 };
	};
}

test("cleanupStaleBranches deletes merged PR head branches", async () => {
	const gh = okGh();
	const res = await cleanupStaleBranches("o", "r", gh);
	assert.equal(res.ok, true);
	assert.ok(res.deleted.some((d) => d.includes("task/1-foo")));
});

test("detectAndLabelConflicts labels conflicting PRs", async () => {
	const gh = okGh();
	const res = await detectAndLabelConflicts("o", "r", gh);
	assert.equal(res.ok, true);
	assert.deepEqual(res.conflicted, [2]);
});

test("countIssueAttempts counts closed PRs referencing the issue", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-attempts-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	const count = await countIssueAttempts(dir, "o", "r", 5, okGh());
	assert.equal(count, 1);
});

test("enforceIssueAttemptLimit labels blocked+needs-human when exceeded", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-ial-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	const res = await enforceIssueAttemptLimit({
		workspace: dir,
		owner: "o",
		repo: "r",
		issueNumber: 5,
		config: { limits: { maxIssueAttempts: 1 } },
		ghFn: okGh(),
	});
	assert.equal(res.exceeded, true);
	assert.match(res.action, /pi:blocked/);
});

test("enforceIssueAttemptLimit returns not exceeded under the limit", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-ial2-"));
	await mkdir(join(dir, ".pi", "logs"), { recursive: true });
	const res = await enforceIssueAttemptLimit({
		workspace: dir,
		owner: "o",
		repo: "r",
		issueNumber: 5,
		config: { limits: { maxIssueAttempts: 10 } },
		ghFn: okGh(),
	});
	assert.equal(res.exceeded, false);
});

test("runReliabilityChecks never throws and returns actions", async () => {
	const res = await runReliabilityChecks("o", "r", okGh(), { log: () => {} });
	assert.equal(res.ok, true);
	assert.ok(Array.isArray(res.actions));
});
