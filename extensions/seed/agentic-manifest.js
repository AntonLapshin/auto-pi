/**
 * Agentic manifest generation for the auto-pi `/loop-seed` flow.
 *
 * After the agentic clarifier collects the user's answers, this module runs a
 * fresh Pi persona that *thinks* about the project — the idea, the user's
 * clarification answers, and the enforced project conventions — and produces a
 * real `manifest.md` that becomes the **backbone of the project**: purpose,
 * goals, non-goals, success criteria, and a milestone roadmap (`M1`, `M2`, …)
 * with concrete, testable scope per milestone.
 *
 * The PM persona reads `manifest.md` to plan issues and split work into
 * milestones (see `personas/pm.md` and `extensions/loop/pm-context.js`), so the
 * milestones produced here directly drive what the Engineer implements. Without
 * this step the scaffolded `manifest.md` is a generic template that does not
 * reflect the user's answers — which is exactly the gap this fixes.
 *
 * Like the clarifier and the loop personas, this launches a fresh
 * non-interactive `pi -p --mode text --no-session` session (see
 * `extensions/loop/persona-runner.js` for the spawn pattern). The agent returns
 * a strict JSON object (purpose/goals/non-goals/success-criteria/milestones)
 * which is rendered into the project's `manifest.md`. When the agent fails or
 * its output is unusable, we fall back to a deterministic manifest built from
 * the template + clarification answers so the project always has a valid
 * backbone.
 *
 * Plain JS on purpose — imported by `extensions/seed/core.js` (via jiti) and
 * directly by tests.
 */

import { spawn } from "node:child_process";
import { resolveProviderModel, providerEnv } from "../loop/provider-env.js";

/** Strict-output markers the agent is asked to wrap its JSON in. */
const OPEN_MARKER = "%%MANIFEST_JSON_BEGIN%%";
const CLOSE_MARKER = "%%MANIFEST_JSON_END%%";

/** How many milestones the manifest should contain. */
const MIN_MILESTONES = 3;
const MAX_MILESTONES = 8;

/**
 * The architect persona prompt appended to the spawned `pi` session's system
 * prompt. Instructs the model to evaluate the idea + answers and emit a strict,
 * parseable JSON manifest with a milestone roadmap.
 */
function architectPrompt() {
	return [
		"You are the 'architect' persona in the auto-pi project initiation flow.",
		"Your job is to take a project idea together with the user's clarification",
		"answers and turn them into a concrete project charter (manifest) that",
		"becomes the backbone of the project: what it is, what it must deliver,",
		"and — crucially — a milestone roadmap that an autonomous PM can plan",
		"small, testable issues against.",
		"",
		"The project is built by an autonomous engineering team that works in small",
		"increments. Each milestone must be a cohesive, demoable increment that",
		"builds toward the final product. Milestones must be ordered so each one",
		"leaves the project in a working, testable state.",
		"",
		"Every milestone needs:",
		`  - "id": "M1", "M2", ... (sequential)`,
		`  - "title": a short human-readable title`,
		`  - "goal": one sentence describing what this milestone delivers`,
		`  - "scope": 2-5 concrete, testable bullet points (what gets built/tested)`,
		"",
		`Produce between ${MIN_MILESTONES} and ${MAX_MILESTONES} milestones. The first`,
		"milestone must be a small, demoable vertical slice. Later milestones add",
		"depth, integrations, and polish. Respect the user's stated priorities,",
		"constraints, and scope from the clarification answers.",
		"",
		"Return ONLY a JSON object of this exact shape, wrapped in the markers:",
		`${OPEN_MARKER}`,
		'{"purpose":"…","goals":["…","…"],"nonGoals":["…"],"successCriteria":["…","…"],"milestones":[{"id":"M1","title":"…","goal":"…","scope":["…","…"]}]}',
		`${CLOSE_MARKER}`,
		"Do not include any prose before or after the markers.",
	].join("\n");
}

/**
 * Build the task text given to the spawned session: the idea + the user's
 * clarification answers (question → answer), formatted as a compact block.
 *
 * @param {object} p { description, projectName, clarification }
 * @returns {string} the task instruction
 */
export function buildManifestTask({ description, projectName, clarification }) {
	const ideaLines = [];
	if (projectName) ideaLines.push(`- Project name: ${projectName}`);
	if (description) ideaLines.push(`- Idea (one-line): ${description}`);
	const idea = ideaLines.length ? ideaLines.join("\n") : "- Idea: (not provided)";

	const answers = clarification?.answers || {};
	const answerLines = Object.entries(answers)
		.map(([id, value]) => `- ${id}: ${String(value ?? "").trim() || "(not specified)"}`)
		.join("\n");

	return [
		"Evaluate the project idea below together with the user's clarification",
		"answers, and generate the project manifest (purpose, goals, non-goals,",
		"success criteria, and milestone roadmap) exactly as your instructions",
		"describe.",
		"",
		"## Idea",
		idea,
		"",
		"## User's clarification answers",
		answerLines || "- (none — using assumptions)",
		"",
		"Emit the JSON manifest between the markers.",
	].join("\n");
}

/**
 * Construct the `pi` CLI argument list for the architect session (mirrors the
 * loop's `buildPersonaArgs` so the spawn behaves identically in batch mode).
 *
 * @param {object} p { task, config?, env? }
 * @returns {string[]}
 */
export function buildManifestArgs({ task, config, env }) {
	const prompt = architectPrompt();
	const args = [
		"-p",
		"--no-session",
		"--mode", "text",
		// Never auto-fetch URLs / hang on network in the batch session.
		"--exclude-tools", "browse,fetch,web_fetch,get_webpage,get_web_content",
		"--name", "architect",
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
export function executeArchitect(args, childEnv, cwd) {
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
export function extractManifestJson(stdout) {
	const text = String(stdout || "");
	let payload = null;

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

/** Coerce a value into a trimmed non-empty string, or null. */
function cleanString(value) {
	const s = String(value ?? "").trim();
	return s ? s : null;
}

/** Coerce a value into a non-empty string array. */
function cleanStringArray(value) {
	if (!Array.isArray(value)) return [];
	return value
		.map((v) => String(v ?? "").trim())
		.filter(Boolean);
}

/**
 * Sanitize a raw milestone into the canonical shape, or null if unusable.
 *
 * @param {any} raw
 * @param {Set<string>} usedIds
 * @returns {object|null}
 */
function sanitizeMilestone(raw, usedIds) {
	if (!raw || typeof raw !== "object") return null;
	const id = String(raw.id || "").trim().toUpperCase();
	if (!/^M\d+$/.test(id) || usedIds.has(id)) return null;
	const title = cleanString(raw.title);
	const goal = cleanString(raw.goal);
	if (!title || !goal) return null;
	const scope = cleanStringArray(raw.scope);
	if (scope.length === 0) return null;

	usedIds.add(id);
	return { id, title, goal, scope };
}

/**
 * Normalize the parsed LLM payload into a canonical manifest object, ensuring
 * the milestone count range and valid shapes. Returns null when the payload is
 * unusable (so callers can fall back to the deterministic manifest).
 *
 * @param {object|null} payload parsed JSON from the agent
 * @returns {object|null}
 */
export function normalizeManifest(payload) {
	if (!payload || typeof payload !== "object") return null;

	const purpose = cleanString(payload.purpose);
	const goals = cleanStringArray(payload.goals);
	const nonGoals = cleanStringArray(payload.nonGoals);
	const successCriteria = cleanStringArray(payload.successCriteria);
	if (!purpose || goals.length === 0 || successCriteria.length === 0) return null;

	const usedIds = new Set();
	const milestones = [];
	for (const raw of Array.isArray(payload.milestones) ? payload.milestones : []) {
		const m = sanitizeMilestone(raw, usedIds);
		if (m) milestones.push(m);
		if (milestones.length >= MAX_MILESTONES) break;
	}
	if (milestones.length < MIN_MILESTONES) return null;

	return {
		purpose,
		goals,
		nonGoals,
		successCriteria,
		milestones,
	};
}

/**
 * Render a canonical manifest object into the project's `manifest.md` text.
 * This is the format the PM persona reads to plan issues/milestones.
 *
 * @param {object} manifest normalized manifest (from `normalizeManifest`)
 * @param {object} p { projectName, description }
 * @returns {string} markdown for manifest.md
 */
export function renderManifest(manifest, { projectName = "", description = "" } = {}) {
	const name = projectName || "Project";
	const goals = manifest.goals.map((g) => `- ${g}`).join("\n");
	const nonGoals = manifest.nonGoals.length
		? manifest.nonGoals.map((g) => `- ${g}`).join("\n")
		: "- Anything beyond the milestones below.";
	const criteria = manifest.successCriteria.map((c) => `- [ ] ${c}`).join("\n");
	const milestones = manifest.milestones
		.map((m) => {
			const scope = m.scope.map((s) => `  - ${s}`).join("\n");
			return `### ${m.id} — ${m.title}\n\n**Goal:** ${m.goal}\n\n**Scope:**\n${scope}`;
		})
		.join("\n\n");

	return [
		`# ${name} — Manifest`,
		``,
		`> Project charter / intent. This file is a living document maintained by the`,
		`> auto-pi PM persona as the project evolves. The milestones below are the`,
		`> backbone of the project: the PM plans issues against them.`,
		``,
		`## Purpose`,
		``,
		manifest.purpose || description,
		``,
		`## Goals`,
		``,
		goals,
		``,
		`## Non-goals`,
		``,
		nonGoals,
		``,
		`## Success criteria`,
		``,
		criteria,
		``,
		`## Milestones`,
		``,
		milestones,
		``,
	].join("\n");
}

/**
 * The main agentic manifest entry point.
 *
 * Runs a fresh `pi` batch session that evaluates the idea + clarification
 * answers and emits a JSON manifest with a milestone roadmap, then normalizes
 * and renders it into `manifest.md` text. When the agent fails (non-zero exit,
 * unparseable output, or fewer than MIN_MILESTONES milestones) it returns null
 * so the caller falls back to the deterministic template-based manifest.
 *
 * @param {object} opts
 * @param {string} [opts.description]   the /loop-seed idea text
 * @param {string} [opts.projectName]   the project name
 * @param {object} [opts.clarification] the `applyAnswers` record ({ answers, usedAssumptions })
 * @param {object} [opts.config]        parsed project config ({ pi: { provider, model } })
 * @param {object} [opts.env]           env for provider/model resolution
 * @param {string} [opts.cwd]           working dir for the spawned session (defaults to process cwd)
 * @param {Function} [opts.execute]     injectable executor `(args, childEnv, cwd) => Promise<{exitCode,stdout,stderr}>`
 *                                      for tests; defaults to `executeArchitect`
 * @returns {Promise<{ ok: boolean, manifest?: object, markdown?: string, source: "agent"|"fallback", rawOutput?: string }>}
 */
export async function agenticManifest(opts = {}) {
	const {
		description = "",
		projectName = "",
		clarification,
		config,
		env,
		cwd,
		execute,
	} = opts;

	const execute_ = execute || executeArchitect;
	const task = buildManifestTask({ description, projectName, clarification });
	const args = buildManifestArgs({ task, config, env });
	const childEnv = providerEnv({ config, env });

	try {
		const res = await execute_(args, childEnv, cwd || process.cwd());
		const rawOutput = (res.stdout || "") + "\n" + (res.stderr || "");
		if (res.exitCode !== 0) {
			return { ok: false, source: "fallback", rawOutput };
		}
		const payload = extractManifestJson(res.stdout || "");
		const manifest = normalizeManifest(payload);
		if (!manifest) {
			return { ok: false, source: "fallback", rawOutput };
		}
		return {
			ok: true,
			source: "agent",
			manifest,
			markdown: renderManifest(manifest, { projectName, description }),
			rawOutput,
		};
	} catch (err) {
		return {
			ok: false,
			source: "fallback",
			rawOutput: String(err?.message || err),
		};
	}
}
