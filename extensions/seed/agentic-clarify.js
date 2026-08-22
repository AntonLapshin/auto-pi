/**
 * Agentic clarification for the auto-pi `/loop-seed` flow.
 *
 * Turns a one-line project idea into a small set of *agent-generated* follow-up
 * questions. Instead of the old static heuristics (which asked the same generic
 * interface/persistence/auth questions for every idea), a fresh Pi persona
 * evaluates the specific idea — what it is, who it is for, what it must do —
 * and asks the questions that actually resolve its ambiguity and elaborate it.
 *
 * The **only** hardcoded question in the whole `/loop-seed` flow is the project
 * *name*, which lives in the command layer (interactive `index.ts` and the CLI
 * `scripts/seed.js`), not here. Everything else is derived by the agent from the
 * idea itself.
 *
 * Like the loop personas, this launches a fresh non-interactive `pi -p --mode
 * text --no-session` session (see `extensions/loop/persona-runner.js` for the
 * spawn pattern). The agent returns a strict JSON list of questions which are
 * parsed into the same `Question[]` shape used by `applyAnswers` and the
 * interactive/CLI askers — so the rest of the flow is unchanged.
 *
 * Plain JS on purpose — imported by both `extensions/seed/core.js` (via the
 * jiti-loaded `index.ts`) and `scripts/seed.js` (via node).
 */

import { spawn } from "node:child_process";
import { resolveProviderModel, providerEnv } from "../loop/provider-env.js";
import { buildQuestions } from "./clarify.js";

/**
 * Question descriptor (same shape as `clarify.js`). `choices` is optional
 * (a single-select); otherwise the answer is free text.
 *
 * @typedef {Object} Question
 * @property {string} id          stable machine id (also the state key)
 * @property {string} prompt      human-ready question
 * @property {string[]} [choices] closed-ended options, first is default
 * @property {any} [assumption]   default used when the user picks "use assumptions"
 */

/** How many questions the agent should aim for. */
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 6;

/** Strict-output marker the agent is asked to wrap its JSON in. */
const OPEN_MARKER = "%%QUESTIONS_JSON_BEGIN%%";
const CLOSE_MARKER = "%%QUESTIONS_JSON_END%%";

/**
 * The clarifier persona prompt appended to the system prompt of the spawned
 * `pi` session. Instructs the model to evaluate the idea and emit a strict,
 * parseable JSON question list.
 */
function clarifierPrompt() {
	return [
		"You are the 'clarifier' persona in the auto-pi project initiation flow.",
		"Your job is to take a one-line project idea, evaluate it critically, and",
		"ask the follow-up questions needed to resolve its ambiguity and elaborate it",
		"into something a scaffold can be built from.",
		"",
		"Do NOT ask for the project name — that is handled separately and is the",
		"only fixed question. Ask only what is genuinely relevant to THIS idea: its",
		"users/audience, primary interface, core feature scope, data it must hold,",
		"integrations, auth, deployment, success criteria, and any risks or unknowns",
		"that a single sentence cannot convey.",
		"",
		`Ask between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions. Prefer closed-ended`,
		"questions (with concrete choices) where a choice truly makes sense; use",
		"open-ended free-text questions where the answer cannot be enumerated.",
		"",
		"Every question must have:",
		`  - "id": a short stable machine id like "audience" or "ui" (lowercase, a-z0-9-)`,
		`  - "prompt": the human-readable question`,
		`  - "choices": an array of options (omit or [] for free text); the FIRST option is the default/assumption`,
		`  - "assumption": a sensible default used when the user skips the question`,
		"",
		"Return ONLY a JSON object of this exact shape, wrapped in the markers:",
		`${OPEN_MARKER}`,
		'{"questions":[{"id":"q1","prompt":"…","choices":["…","…"],"assumption":"…"}]}',
		`${CLOSE_MARKER}`,
		"Do not include any prose before or after the markers.",
	].join("\n");
}

/**
 * Build the task text given to the spawned session.
 *
 * @param {object} p { description, projectName }
 * @returns {string} the task instruction
 */
export function buildClarifyTask({ description, projectName }) {
	const ideaLines = [];
	if (projectName) ideaLines.push(`- Project name: ${projectName}`);
	if (description) ideaLines.push(`- Idea (one-line): ${description}`);
	const idea = ideaLines.length ? ideaLines.join("\n") : "- Idea: (not provided - ask for a brief idea if needed)";
	return [
		"Evaluate the following project idea and generate the clarifying questions",
		"needed to disambiguate and elaborate it, exactly as your instructions",
		"describe.",
		"",
		idea,
		"",
		"Emit the JSON questions between the markers.",
	].join("\n");
}

/**
 * Construct the `pi` CLI argument list for a clarifier session (mirrors the
 * loop's `buildPersonaArgs` so the spawn behaves identically in batch mode).
 *
 * @param {object} p { task, config?, env? }
 * @returns {string[]}
 */
export function buildClarifyArgs({ task, config, env }) {
	const prompt = clarifierPrompt();
	const args = [
		"-p",
		"--no-session",
		"--mode", "text",
		// Never auto-fetch URLs / hang on network in the batch session.
		"--exclude-tools", "browse,fetch,web_fetch,get_webpage,get_web_content",
		"--name", "clarifier",
		"--append-system-prompt", prompt,
		task,
	];
	const { provider, model } = resolveProviderModel({ config, env: env || process.env });
	if (provider) args.push("--provider", provider);
	if (model) args.push("--model", model);
	return args;
}

/**
 * The real underlying `pi` invocation (mirrors `executePi` in
 * `extensions/loop/persona-runner.js`). Uses Node's `child_process.spawn`
 * (not execa — execa v10 spawns a Bun/pi child that hangs in ep_poll with zero
 * CPU). Never throws.
 *
 * @param {string[]} args
 * @param {object} childEnv
 * @param {string} cwd
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export function executeClarify(args, childEnv, cwd) {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let child;
		try {
			child = spawn("pi", args, {
				cwd,
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
 * Extract the JSON object from the agent's output. Looks for the marker block
 * first, then falls back to the first `{...}` span in the output. Returns null
 * when no object could be found.
 *
 * @param {string} stdout
 * @returns {object|null}
 */
export function extractQuestionsJson(stdout) {
	const text = String(stdout || "");
	let payload = null;

	// Prefer the marker-embedded block.
	const openIdx = text.indexOf(OPEN_MARKER);
	const closeIdx = text.indexOf(CLOSE_MARKER);
	if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
		const block = text.slice(openIdx + OPEN_MARKER.length, closeIdx);
		try {
			payload = JSON.parse(block);
		} catch {
			payload = null;
		}
	}

	// Fall back to the first balanced JSON object in the whole output.
	if (!payload) {
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start !== -1 && end > start) {
			try {
				payload = JSON.parse(text.slice(start, end + 1));
			} catch {
				payload = null;
			}
		}
	}
	return payload;
}

/**
 * Sanitize a raw agent question into the canonical `Question` shape, dropping
 * entries that are missing an id/prompt or whose id collides with a reserved
 * one (the project name is asked separately, so "name"/"project" ids would be
 * confusing — the agent is told not to ask it, but we guard anyway).
 *
 * @param {any} raw
 * @param {Set<string>} usedIds
 * @returns {Question|null}
 */
function sanitizeQuestion(raw, usedIds) {
	if (!raw || typeof raw !== "object") return null;
	const id = String(raw.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
	const prompt = String(raw.prompt || "").trim();
	if (!id || id.length > 40 || !prompt) return null;
	// Reserved ids handled outside the agent (project name lives in the command layer).
	if (id === "name" || id === "project" || id === "projectname" || usedIds.has(id)) return null;

	const choices = Array.isArray(raw.choices)
		? raw.choices.map((c) => String(c).trim()).filter(Boolean)
		: [];
	// An empty/one-element choice list is a free-text question.
	const hasChoices = choices.length >= 2;
	let assumption = raw.assumption;
	if (assumption === undefined || assumption === null || assumption === "") {
		assumption = hasChoices ? choices[0] : "";
	} else {
		assumption = String(assumption);
	}

	usedIds.add(id);
	return {
		id,
		prompt,
		choices: hasChoices ? choices : [],
		assumption,
	};
}

/**
 * Normalize the parsed LLM payload into a `Question[]`, ensuring the MAX_QUESTIONS
 * cap and a valid shape for every entry. Returns [] when the payload is unusable
 * (so callers can fall back to the static questions).
 *
 * @param {object|null} payload parsed JSON from the agent
 * @returns {Question[]}
 */
export function normalizeQuestions(payload) {
	if (!payload || !Array.isArray(payload.questions)) return [];
	const usedIds = new Set();
	const questions = [];
	for (const raw of payload.questions) {
		const q = sanitizeQuestion(raw, usedIds);
		if (q) questions.push(q);
		if (questions.length >= MAX_QUESTIONS) break;
	}
	return questions;
}

/**
 * The main agentic clarification entry point.
 *
 * Runs a fresh `pi` batch session that evaluates the idea and emits a JSON list
 * of follow-up questions, then normalizes them into the canonical `Question[]`
 * consumed by the rest of the seed flow. When the agent fails (non-zero exit,
 * unparseable output, or fewer than MIN_QUESTIONS valid questions) it falls
 * back to the static generic questions so the flow can always proceed.
 *
 * @param {object} opts
 * @param {string} [opts.description]   the /loop-seed idea text
 * @param {string} [opts.projectName]   the (hardcoded) project name for context
 * @param {object} [opts.config]        parsed project config ({ pi: { provider, model } })
 * @param {object} [opts.env]           env for provider/model resolution
 * @param {string} [opts.cwd]           working dir for the spawned session (defaults to process cwd)
 * @param {Function} [opts.execute]     injectable executor `(args, childEnv, cwd) => Promise<{exitCode,stdout,stderr}>`
 *                                      for tests; defaults to `executeClarify`
 * @returns {Promise<{ questionSource: "agent"|"fallback", questions: Question[], rawOutput?: string }>}
 */
export async function agenticClarify(opts = {}) {
	const {
		description = "",
		projectName = "",
		config,
		env,
		cwd,
		execute,
	} = opts;

	const fallback = buildQuestions(description, projectName);
	const execute_ = execute || executeClarify;

	const task = buildClarifyTask({ description, projectName });
	const args = buildClarifyArgs({ task, config, env });
	const childEnv = providerEnv({ config, env });
	try {
		const res = await execute_(args, childEnv, cwd || process.cwd());
		const rawOutput = (res.stdout || "") + "\n" + (res.stderr || "");
		if (res.exitCode !== 0) {
			return { questionSource: "fallback", questions: fallback, rawOutput };
		}
		const payload = extractQuestionsJson(res.stdout || "");
		const questions = normalizeQuestions(payload);
		if (questions.length < MIN_QUESTIONS) {
			return { questionSource: "fallback", questions: fallback, rawOutput };
		}
		return {
			questionSource: "agent",
			questions: questions.slice(0, MAX_QUESTIONS),
			rawOutput,
		};
	} catch (err) {
		return {
			questionSource: "fallback",
			questions: fallback,
			rawOutput: String(err?.message || err),
		};
	}
}
