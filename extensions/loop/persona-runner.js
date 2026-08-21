/**
 * Fresh persona runner for the auto-pi loop (M6, plan.md §14 / §29.3).
 *
 * Launches a fresh Pi persona session to perform one unit of work. Each
 * invocation is a brand-new child process with:
 *
 *   - a unique run ID (used as the run directory + session name)
 *   - no session persistence (`--no-session`) — personas never remember
 *     prior conversations
 *   - the persona prompt loaded from `personas/{name}.md`
 *   - a minimal context file written to the run dir and passed to the child
 *   - stdout/stderr captured into the run dir
 *
 * The `pi` CLI does not expose a dedicated `--fresh/--persona/--run-id` flag
 * bundle, so we emulate it with the standard flags: `pi -p --no-session
 * --session-id <runId> --append-system-prompt <persona> --name <runId>
 * @<context> "<task>"`.
 *
 * Plain JS on purpose — imported via jiti by the extension and directly by
 * tests / node scripts.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { RUNS_DIR_REL } from "./constants.js";
import {
	appendRunRecord,
	appendErrorRecord,
	accumulateTokens,
	buildRunRecord,
	appendEvent,
	appendHealth,
	parseGitCommands,
	classifyGitCommand,
} from "../../skills/logging/core.js";
import { backoffDelay, sleep } from "../../skills/github/core.js";
import { resolveProviderModel, providerEnv } from "./provider-env.js";

/**
 * Resolve the provider/model a persona session should use. See
 * `extensions/loop/provider-env.js` (`resolveProviderModel`) for the shared
 * resolution order. Delegated wrapper kept for API stability/compat.
 *
 * @param {object} [opts]
 * @param {object} [opts.config]   parsed project config (`{ pi: { provider, model } }`)
 * @param {object} [opts.env]      environment to read PI_* from (defaults to process.env)
 * @returns {{ provider: string, model: string }}
 */
export function resolvePiModelSync(opts = {}) {
	return resolveProviderModel({ config: opts.config, env: opts.env });
}

/**
 * Default number of retries for a failed persona (LLM) invocation, in addition
 * to the first attempt (config.pi.maxRetries).
 */
export const DEFAULT_PERSONA_MAX_RETRIES = 2;

/** Default base backoff delay (ms) between persona retries (config.pi.retryBaseDelayMs). */
export const DEFAULT_PERSONA_RETRY_BASE_DELAY_MS = 5000;

/** Default max backoff delay (ms) for persona retries (config.pi.retryMaxDelayMs). */
export const DEFAULT_PERSONA_RETRY_MAX_DELAY_MS = 30000;

/**
 * True when a persona (LLM) invocation failure looks transient and is worth
 * retrying: network/timeout/server errors, empty output, or a process that
 * failed to spawn. Non-transient failures (e.g. bad config, auth rejection)
 * fail fast instead of burning retries.
 *
 * @param {object} res { exitCode, stdout, stderr }
 * @returns {boolean}
 */
export function isRetryablePersonaFailure(res) {
	const exitCode = Number(res?.exitCode);
	const stderr = String(res?.stderr || "");
	const stdout = String(res?.stdout || "");

	// Process failed to spawn / crashed (no real exit code) → retry.
	if (res?.exitCode === null || res?.exitCode === undefined || Number.isNaN(exitCode)) return true;

	// Empty output with a non-zero exit is suspicious (likely a transient
	// provider/network failure) → retry.
	if (exitCode !== 0 && !stdout && !stderr) return true;

	const text = `${stdout}\n${stderr}`;
	return (
		/rate limit/i.test(text) ||
		/rate_limit/i.test(text) ||
		/timed?\s*out/i.test(text) ||
		/network/i.test(text) ||
		/ECONNRESET/i.test(text) ||
		/ETIMEDOUT/i.test(text) ||
		/EPIPE/i.test(text) ||
		/5\d\d\b/.test(text) ||
		/temporarily unavailable/i.test(text) ||
		/connection refused/i.test(text) ||
		/502 bad gateway/i.test(text) ||
		/503 service unavailable/i.test(text) ||
		/504 gateway timeout/i.test(text) ||
		/429/.test(text) ||
		/overloaded/i.test(text) ||
		/insufficient_quota/i.test(text) ||
		/context_length_exceeded/i.test(text)
	);
}

/**
 * Read the retry settings from a parsed config (config.pi.maxRetries,
 * retryBaseDelayMs, retryMaxDelayMs), applying defaults.
 *
 * @param {object} [config]
 * @returns {{ maxRetries: number, baseDelayMs: number, maxDelayMs: number }}
 */
export function personaRetrySettings(config = {}) {
	const pi = config?.pi || {};
	const num = (v, def) => {
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 ? n : def;
	};
	return {
		maxRetries: num(pi.maxRetries, DEFAULT_PERSONA_MAX_RETRIES),
		baseDelayMs: num(pi.retryBaseDelayMs, DEFAULT_PERSONA_RETRY_BASE_DELAY_MS),
		maxDelayMs: num(pi.retryMaxDelayMs, DEFAULT_PERSONA_RETRY_MAX_DELAY_MS),
	};
}

/**
 * Generate a unique run ID: `{persona}-{yyyymmdd-hhmmss}-{shortId}`.
 *
 * @param {string} persona
 * @returns {string}
 */
export function newRunId(persona) {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	const short = randomUUID().slice(0, 8);
	return `${persona}-${stamp}-${short}`;
}

/**
 * Resolve the path to a persona prompt file (`personas/{name}.md` in the
 * harness repo). Falls back to a minimal built-in prompt if the file is
 * missing (M7–M9 add the real persona prompts).
 *
 * @param {string} persona
 * @param {object} [opts] { personasDir? }
 * @returns {Promise<string>} the prompt text
 */
export async function loadPersonaPrompt(persona, opts = {}) {
	const { readFile } = await import("node:fs/promises");
	const { existsSync } = await import("node:fs");
	const dir = opts.personasDir || new URL("../../personas/", import.meta.url).pathname;
	const file = join(dir, `${persona}.md`);
	if (existsSync(file)) {
		try {
			return await readFile(file, "utf8");
		} catch {
			// fall through to built-in
		}
	}
	// Minimal built-in fallback so the loop can run before M7–M9 ship prompts.
	return [
		`You are the "${persona}" persona in the auto-pi autonomous engineering team.`,
		`Work autonomously on the task described in the context file.`,
		`Do not ask for confirmation; act, test, and report.`,
	].join("\n");
}

/**
 * Synchronous persona-prompt loader (used by `buildPersonaArgs`). Reads
 * `personas/{name}.md` when present, else returns the minimal built-in prompt.
 *
 * @param {string} persona
 * @param {object} [opts] { personasDir? }
 * @returns {string}
 */
export function loadPersonaPromptSync(persona, opts = {}) {
	const dir = opts.personasDir || new URL("../../personas/", import.meta.url).pathname;
	const file = join(dir, `${persona}.md`);
	if (existsSync(file)) {
		try {
			return readFileSync(file, "utf8");
		} catch {
			// fall through to built-in
		}
	}
	return [
		`You are the "${persona}" persona in the auto-pi autonomous engineering team.`,
		`Work autonomously on the task described in the context file.`,
		`Do not ask for confirmation; act, test, and report.`,
	].join("\n");
}

/**
 * Build the minimal context passed to a persona session (plan.md §13.1 step 7).
 * Written to `{workspace}/.pi/runs/{runId}/context.md`.
 *
 * @param {object} params
 * @param {object} params.config      parsed .pi/config.json
 * @param {object} params.state       scanned GitHub state
 * @param {object} params.decision    dispatcher decision { decision, persona, reason }
 * @returns {string} markdown context
 */
export function buildContext({ config, state, decision }) {
	const project = config?.project || {};
	const lines = [
		`# auto-pi persona context`,
		``,
		`## Project`,
		``,
		`- Name: ${project.name || ""}`,
		`- Repo: ${project.owner || ""}/${project.repo || ""}`,
		`- Default branch: ${project.defaultBranch || "main"}`,
		`- Demo URL: ${project.demoUrl || "(not yet)"}`,
		``,
		`## Dispatch`,
		``,
		`- Decision: ${decision?.decision || "unknown"}`,
		`- Persona: ${decision?.persona || "unknown"}`,
		`- Reason: ${decision?.reason || ""}`,
		``,
		`## GitHub state (scanned at ${state?.scannedAt || "unknown"})`,
		``,
	];
	if (state?.issues?.length) {
		lines.push(`### Open issues`, ``);
		for (const i of state.issues) {
			lines.push(`- #${i.number} **${i.title}** [${i.labels.join(", ") || "no labels"}]`);
		}
		lines.push(``);
	} else {
		lines.push(`No open issues.`, ``);
	}
	if (state?.prs?.length) {
		lines.push(`### Open PRs`, ``);
		for (const p of state.prs) {
			lines.push(`- #${p.number} **${p.title}** (review: ${p.review}, mergeable: ${p.mergeable}) [${p.labels.join(", ") || "no labels"}]`);
		}
		lines.push(``);
	} else {
		lines.push(`No open PRs.`, ``);
	}
	lines.push(`### CI`, ``);
	lines.push(`- Latest workflow run: ${state?.ci?.status || "unknown"} / ${state?.ci?.conclusion || "unknown"}${state?.ci?.headBranch ? ` (${state.ci.headBranch})` : ""}`);
	lines.push(``);
	lines.push(`## Task`, ``);
	lines.push(`Given the dispatch decision "${decision?.decision}" and reason "${decision?.reason || ""}", perform the work for the "${decision?.persona || ""}" persona on this project.`);
	lines.push(``);
	return lines.join("\n");
}

/**
 * Write the context file and ledger entry for a run.
 *
 * @param {string} workspace  absolute project root
 * @param {string} runId
 * @param {object} payload    { persona, decision, config, state, buildContext? }
 *                            `buildContext` is an optional custom context
 *                            builder (e.g. the PM packer from M7); when absent
 *                            the generic minimal builder is used.
 * @returns {Promise<{ runDir: string, contextFile: string }>}
 */
export async function prepareRun(workspace, runId, payload) {
	const runDir = join(workspace, RUNS_DIR_REL, runId);
	await mkdir(runDir, { recursive: true });
	const builder = payload.buildContext || buildContext;
	const context = await builder(payload);
	const contextFile = join(runDir, "context.md");
	await writeFile(contextFile, context, "utf8");
	return { runDir, contextFile };
}

/**
 * Launch a fresh Pi persona session (plan.md §14 / §29.3).
 *
 * Uses `pi -p` (non-interactive print mode) with `--no-session` and an explicit
 * `--mode text` so the persona has no memory of any prior conversation and never
 * blocks reading an open stdin (a plain `-p` without `--mode` can hang when the
 * spawned process inherits a controlling terminal / open stdin). The persona
 * prompt is appended to the system prompt and the context file is passed as a
 * file argument.
 *
 * @param {object} opts
 * @param {string} opts.workspace    absolute project root
 * @param {string} opts.persona      persona name (pm / engineer / review-engineer)
 * @param {string} opts.runId        unique run ID
 * @param {string} opts.contextFile  absolute path to the context file
 * @param {string} [opts.task]       optional task instruction (defaults to reading the context)
 * @param {object} [opts.config]     parsed config (model/provider)
 * @param {object} [opts.env]        extra env vars (e.g. PI_MODEL / PI_PROVIDER)
 * @param {Function} [opts.execute]  optional underlying executor
 *                                  `(args, childEnv, cwd) => Promise<{ exitCode, stdout, stderr }>`
 *                                  used for tests; defaults to running `pi` via execa.
 * @returns {Promise<{ ok: boolean, exitCode: number, stdout: string, stderr: string, runDir: string }>}
 */
export async function runPersona({
	workspace,
	persona,
	runId,
	contextFile,
	task,
	config,
	env,
	execute,
}) {
	const runDir = join(workspace, RUNS_DIR_REL, runId);
	await mkdir(runDir, { recursive: true });

	const args = buildPersonaArgs({ persona, runId, contextFile, task, config, env });
	const childEnv = buildChildEnv({ config, env });

	const startedAt = new Date().toISOString();
	const res = await (execute
		? execute(args, childEnv, workspace)
		: executePi(args, childEnv, workspace));
	const finishedAt = new Date().toISOString();

	return finalizePersonaRun({
		workspace,
		persona,
		runId,
		config,
		res,
		startedAt,
		finishedAt,
		runDir,
	});
}

/**
 * Build the `pi` CLI argument list for a persona run (shared by `runPersona`
 * and `runPersonaWithRetry`).
 *
 * @param {object} p { persona, runId, contextFile, task?, config?, env? }
 * @returns {string[]}
 */
export function buildPersonaArgs({ persona, runId, contextFile, task, config, env }) {
	const prompt = loadPersonaPromptSync(persona);
	const taskText = task || `Read the context file and perform the work described for the "${persona}" persona.`;

	const args = [
		"-p",
		"--no-session",
		"--mode", "text",
		// Never auto-fetch URLs: the context files contain live links (repo/demo/
		// changelog URLs) and pi's model can decide to `browse`/fetch them, which
		// opens a blocked network fetch to an arbitrary host and hangs the sole
		// batch `pi -p` invocation with zero output (0 CPU, stuck in ep_poll
		// before the LLM call). Excluding the web tools keeps the persona firmly
		// in batch mode. Unknown names are ignored by pi; `browse` is the real
		// built-in fetch tool on this version.
		"--exclude-tools", "browse,fetch,web_fetch,get_webpage,get_web_content",
		"--name", runId,
		"--append-system-prompt", prompt,
		contextFile,
		taskText,
	];

	// Optional model/provider selection. Resolve the effective provider/model so
	// a detached loop (which does not inherit the interactive session's
	// PI_PROVIDER/PI_MODEL) still pins the model instead of hanging on pi's
	// default (unauthenticated) google provider.
	const { provider, model } = resolvePiModelSync({ config, env: env || process.env });
	if (provider) args.push("--provider", provider);
	if (model) args.push("--model", model);

	// M13: per-persona token caps were originally attempted via pi's
	// `--max-context/--max-prompt/--max-output` flags, but this pi version does
	// NOT support those options — it hard-errors on unknown options, failing
	// every persona session. The budget guardrails are instead enforced at the
	// loop level (limits.maxTokensPerCycle / maxTokensPerDay via
	// checkCycleBudget/budgetExceeded), so we drop the unsupported per-persona
	// flags entirely rather than breaking persona runs.
	// (personaTokenFlags() intentionally NOT applied — pi rejects these flags.)

	return args;
}

/**
 * Build the child environment for a spawned `pi` persona process.
 *
 * Merges the caller-supplied env over the current process env, then ensures
 * `PI_PROVIDER` / `PI_MODEL` reflect the *resolved* provider/model (not just
 * whatever the loop happened to inherit). This makes the spawned `pi` default
 * to the intended model even when the loop process itself was started without
 * these env vars (the detached `nohup` case from `/loop-seed`).
 *
 * @param {object} [opts]
 * @param {object} [opts.config]  parsed project config
 * @param {object} [opts.env]     extra env vars to merge over the current env
 * @returns {object} child environment object
 */
export function buildChildEnv({ config, env } = {}) {
	return providerEnv({ config, env });
}

/**
 * The real underlying `pi` invocation. Never throws.
 *
 * Uses Node's raw `child_process.spawn` (NOT execa): execa v10 spawns a
 * `pi`/Bun child in a way that makes it hang in `ep_poll` with zero CPU and no
 * LLM/API connection — verified empirically (a trivial `pi -p` completes in
 * ~4s via `spawn` but never returns via `execa`). Switching to `spawn` fixes
 * the loop's perpetual "running persona …" state.
 *
 * stdin is closed (`ignore`) so `pi` stays in batch mode and never reads the
 * shared tty; stdout/stderr are piped and resolved as promises on exit.
 *
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export async function executePi(args, childEnv, workspace) {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let child;
		try {
			child = spawn("pi", args, {
				cwd: workspace,
				env: childEnv,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			resolve({ exitCode: 1, stdout: "", stderr: String(err?.message || err) });
			return;
		}
		child.stdout.on("data", (d) => { stdout += d; });
		child.stderr.on("data", (d) => { stderr += d; });
		child.on("error", (err) => {
			resolve({ exitCode: 1, stdout, stderr: String(err?.message || err) });
		});
		child.on("close", (code) => {
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
	});
}

/**
 * Post-process a completed persona run: capture output, parse tokens, append
 * the run ledger + error records, accumulate token usage, and return the
 * result object. This runs exactly once per logical run (after retries are
 * exhausted) so intermediate failed attempts are never double-logged.
 *
 * @param {object} p
 * @returns {Promise<{ ok, exitCode, stdout, stderr, runDir, tokens, durationSeconds }>}
 */
export async function finalizePersonaRun({ workspace, persona, runId, config, res, startedAt, finishedAt, runDir }) {
	// Capture output in the run dir.
	await writeFile(join(runDir, "stdout.txt"), res.stdout || "", "utf8").catch(() => {});
	await writeFile(join(runDir, "stderr.txt"), res.stderr || "", "utf8").catch(() => {});

	// M10: token/cost accounting. Parse token usage from pi output when present
	// (best-effort; defaults to 0 when the CLI does not report it).
	const tokens = parseTokenUsage(res.stdout || "", res.stderr || "");
	const durationSeconds = Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
	const gitSha = await currentGitSha(workspace);

	// Append a full run record (plan.md §20.1 schema) and accumulate token usage.
	const record = buildRunRecord({
		runId,
		persona,
		trigger: "loop",
		projectName: config?.project?.name || "",
		repo: [config?.project?.owner, config?.project?.repo].filter(Boolean).join("/"),
		status: res.exitCode === 0 ? "ok" : "error",
		action: res.exitCode === 0 ? "ran" : "error",
		reason: res.exitCode === 0 ? "completed" : "persona session failed",
		error: res.exitCode === 0 ? "" : (res.stderr || "").slice(0, 2000),
		startedAt,
		finishedAt,
		tokensInput: tokens.tokensInput,
		tokensOutput: tokens.tokensOutput,
		tokensTotal: tokens.tokensTotal,
		durationSeconds,
		gitSha,
	});
	await appendRunRecord(workspace, record, config).catch(() => {});
	await accumulateTokens(workspace, {
		tokensInput: tokens.tokensInput,
		tokensOutput: tokens.tokensOutput,
		tokensTotal: tokens.tokensTotal,
		runs: 1,
	}, config).catch(() => {});
	if (res.exitCode !== 0) {
		await appendErrorRecord(workspace, {
			runId,
			persona,
			error: (res.stderr || res.stdout || "").slice(0, 2000),
		}, config).catch(() => {});
	}

	// --- Structured progress events + LLM health (auto-pi UI observability) ---
	const ok = res.exitCode === 0;
	// Emit a deterministic "persona finished" event with the run outcome.
	await appendEvent(workspace, {
		type: ok ? "persona.finished" : "persona.failed",
		persona,
		runId,
		data: {
			status: ok ? "ok" : "error",
			exitCode: res.exitCode,
			tokensInput: tokens.tokensInput,
			tokensOutput: tokens.tokensOutput,
			tokensTotal: tokens.tokensTotal,
			durationSeconds,
			gitSha,
		},
	}, config).catch(() => {});

	// Parse git/gh commands the persona executed and emit them as events. Each
	// command is logged once (git.command / gh.command) and, when it maps to a
	// known project-lifecycle action (issue/PR create/review/approve/merge,
	// label assignment, commit/push), also as a classified event so the UI can
	// render progress without parsing prose.
	const commands = parseGitCommands(res.stdout || "", res.stderr || "");
	for (const c of commands) {
		const cls = classifyGitCommand(c);
		await appendEvent(workspace, {
			type: cls.type,
			persona,
			runId,
			data: cls.data,
		}, config).catch(() => {});
	}

	// LLM-provider health: one record per invocation outcome.
	await appendHealth(workspace, {
		provider: config?.pi?.provider || "",
		model: config?.pi?.model || "",
		runId,
		persona,
		ok,
		exitCode: res.exitCode,
		durationMs: Math.round(durationSeconds * 1000),
		reason: ok ? "" : (res.stderr || res.stdout || "").slice(0, 200),
	}, config).catch(() => {});

	return {
		ok,
		exitCode: res.exitCode,
		stdout: res.stdout || "",
		stderr: res.stderr || "",
		runDir,
		tokens,
		durationSeconds,
		commands,
	};
}

/**
 * Run a fresh Pi persona session with retry/backoff around the underlying LLM
 * invocation (M13 hardening for unstable providers).
 *
 * This is the loop's entry point for launching a persona. It wraps `runPersona`
 * so a transient failure of a single LLM command (network blip, 5xx, timeout,
 * rate limit, empty output) is retried with exponential backoff + jitter
 * instead of burning a whole loop cycle. Non-transient failures (e.g. bad
 * config, auth rejection) fail fast without retrying.
 *
 * Retry behaviour is configurable via `config.pi.*`:
 *   - `maxRetries`        (default 2)   retries in addition to the first attempt
 *   - `retryBaseDelayMs`  (default 5000) base backoff, doubles per retry
 *   - `retryMaxDelayMs`   (default 30000) cap on the backoff delay
 *
 * Only the final result is logged/recorded by `runPersona`; intermediate
 * failed attempts are surfaced via the optional `onRetry` callback (used by the
 * orchestrator for loop logging) and are NOT appended to the run ledger.
 *
 * @param {object} opts  same as `runPersona` (workspace, persona, runId,
 *                       contextFile, task, config, env, execute)
 * @param {Function} [opts.onRetry] `(info) => void` called before each retry with
 *                       { attempt, reason, delayMs }
 * @returns {Promise<object>} the `runPersona` result, plus `retries` (number of
 *                       retries performed) and `retryable` (whether the last
 *                       failure was considered retryable).
 */
export async function runPersonaWithRetry(opts = {}) {
	const { maxRetries, baseDelayMs, maxDelayMs } = personaRetrySettings(opts.config);
	const onRetry = typeof opts.onRetry === "function" ? opts.onRetry : () => {};
	const execute = opts.execute || executePi;

	const {
		workspace,
		persona,
		runId,
		contextFile,
		task,
		config,
		env,
	} = opts;

	const runDir = join(workspace, RUNS_DIR_REL, runId);
	await mkdir(runDir, { recursive: true });

	const args = buildPersonaArgs({ persona, runId, contextFile, task, config, env });
	const childEnv = buildChildEnv({ config, env });

	let retries = 0;
	let lastRes = null;
	let lastRetryable = false;

	while (true) {
		const res = await execute(args, childEnv, workspace);
		lastRes = res;
		if (res.exitCode === 0) break;

		const retryable = isRetryablePersonaFailure(res);
		lastRetryable = retryable;
		if (!retryable || retries >= maxRetries) break;

		const delayMs = backoffDelay(retries, { baseDelayMs, maxDelayMs });
		const reason = (res.stderr || res.stdout || "").slice(0, 200) || "persona invocation failed";
		onRetry({
			attempt: retries + 1,
			reason,
			delayMs,
		});
		// Record the retry as an LLM-health event so the UI can surface provider
		// instability (retry frequency, failure reasons) over time.
		await appendEvent(workspace, {
			type: "llm.retry",
			persona,
			runId,
			data: {
				attempt: retries + 1,
				delayMs,
				retryable,
				exitCode: res.exitCode,
				reason,
			},
		}, config).catch(() => {});
		await appendHealth(workspace, {
			provider: config?.pi?.provider || "",
			model: config?.pi?.model || "",
			runId,
			persona,
			ok: false,
			exitCode: res.exitCode,
			retries: retries + 1,
			retryable,
			reason,
		}, config).catch(() => {});
		await sleep(delayMs);
		retries += 1;
	}

	const startedAt = new Date().toISOString();
	const finishedAt = new Date().toISOString();
	const result = await finalizePersonaRun({
		workspace,
		persona,
		runId,
		config,
		res: lastRes,
		startedAt,
		finishedAt,
		runDir,
	});

	return { ...result, retries, retryable: lastRetryable };
}

/**
 * Best-effort parse of token usage from pi CLI output. Looks for common
 * `X input tokens / Y output tokens` or `tokens: {...}` markers in stdout/stderr.
 * @returns {{ tokensInput: number, tokensOutput: number, tokensTotal: number }}
 */
export function parseTokenUsage(stdout, stderr) {
	const text = `${stdout || ""}\n${stderr || ""}`;
	let tokensInput = 0;
	let tokensOutput = 0;

	// JSON shape: tokens: { input: N, output: M } or { prompt: N, completion: M }
	const jsonMatch = text.match(/tokens\s*[:=]\s*\{([^}]*)\}/i);
	if (jsonMatch) {
		const body = jsonMatch[1];
		const inM = body.match(/"?(?:input|prompt)"?\s*[:=]\s*(\d+)/i);
		const outM = body.match(/"?(?:output|completion)"?\s*[:=]\s*(\d+)/i);
		tokensInput = inM ? Number(inM[1]) : 0;
		tokensOutput = outM ? Number(outM[1]) : 0;
	}

	// Plain shape: "N input tokens" / "M output tokens"
	if (!tokensInput) {
		const inM = text.match(/(\d+)\s+input\s+tokens/i);
		tokensInput = inM ? Number(inM[1]) : 0;
	}
	if (!tokensOutput) {
		const outM = text.match(/(\d+)\s+output\s+tokens/i);
		tokensOutput = outM ? Number(outM[1]) : 0;
	}

	// Plain shape: "N tokens used" → treat as total.
	let tokensTotal = tokensInput + tokensOutput;
	if (!tokensTotal) {
		const totM = text.match(/(\d+)\s+tokens?\s+used/i);
		if (totM) tokensTotal = Number(totM[1]);
	}

	return { tokensInput, tokensOutput, tokensTotal };
}

/** Best-effort current git SHA of the workspace (empty when not a git repo). */
async function currentGitSha(workspace) {
	try {
		const { execa } = await import("execa");
		const res = await execa("git", ["rev-parse", "HEAD"], {
			cwd: workspace,
			reject: false,
			timeout: 10000,
		});
		return res.exitCode === 0 ? (res.stdout || "").trim() : "";
	} catch {
		return "";
	}
}
