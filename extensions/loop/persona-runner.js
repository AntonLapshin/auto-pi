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
import { RUNS_DIR_REL, RUN_LEDGER_VERSION } from "./constants.js";

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
 * @param {object} payload    { persona, decision, config, state }
 * @returns {Promise<{ runDir: string, contextFile: string }>}
 */
export async function prepareRun(workspace, runId, payload) {
	const runDir = join(workspace, RUNS_DIR_REL, runId);
	await mkdir(runDir, { recursive: true });
	const context = buildContext(payload);
	const contextFile = join(runDir, "context.md");
	await writeFile(contextFile, context, "utf8");
	return { runDir, contextFile };
}

/**
 * Launch a fresh Pi persona session (plan.md §14 / §29.3).
 *
 * Uses `pi -p` (non-interactive print mode) with `--no-session` so the persona
 * has no memory of any prior conversation. The persona prompt is appended to
 * the system prompt and the context file is passed as a file argument.
 *
 * @param {object} opts
 * @param {string} opts.workspace    absolute project root
 * @param {string} opts.persona      persona name (pm / engineer / review-engineer)
 * @param {string} opts.runId        unique run ID
 * @param {string} opts.contextFile  absolute path to the context file
 * @param {string} [opts.task]       optional task instruction (defaults to reading the context)
 * @param {object} [opts.config]     parsed config (model/provider)
 * @param {object} [opts.env]        extra env vars (e.g. PI_MODEL / PI_PROVIDER)
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
}) {
	const { execa } = await import("execa");
	const { appendFile } = await import("node:fs/promises");

	const runDir = join(workspace, RUNS_DIR_REL, runId);
	await mkdir(runDir, { recursive: true });

	const prompt = await loadPersonaPrompt(persona);
	const taskText = task || `Read the context file and perform the work described for the "${persona}" persona.`;

	const args = [
		"-p",
		"--no-session",
		"--name", runId,
		"--append-system-prompt", prompt,
		contextFile,
		taskText,
	];

	// Optional model/provider selection from the project config.
	if (config?.pi?.provider) args.push("--provider", config.pi.provider);
	if (config?.pi?.model) args.push("--model", config.pi.model);

	const childEnv = { ...process.env, ...(env || {}) };

	const startedAt = new Date().toISOString();
	let res;
	try {
		res = await execa("pi", args, {
			cwd: workspace,
			env: childEnv,
			reject: false,
			timeout: 0, // persona work can take a while; loop controls cadence
		});
	} catch (err) {
		res = { exitCode: err?.exitCode ?? 1, stdout: "", stderr: String(err?.message || err) };
	}
	const finishedAt = new Date().toISOString();

	// Capture output in the run dir.
	await writeFile(join(runDir, "stdout.txt"), res.stdout || "", "utf8").catch(() => {});
	await writeFile(join(runDir, "stderr.txt"), res.stderr || "", "utf8").catch(() => {});

	// Append a ledger line (M10 fills in token/cost accounting).
	const entry = {
		version: RUN_LEDGER_VERSION,
		runId,
		persona,
		decision: "run",
		startedAt,
		finishedAt,
		exitCode: res.exitCode,
		ok: res.exitCode === 0,
		runDir: join(RUNS_DIR_REL, runId),
		tokensUsed: 0,
		costUsd: 0,
	};
	await appendFile(join(workspace, RUNS_LEDGER_REL), JSON.stringify(entry) + "\n", "utf8").catch(() => {});

	return {
		ok: res.exitCode === 0,
		exitCode: res.exitCode,
		stdout: res.stdout || "",
		stderr: res.stderr || "",
		runDir,
	};
}
