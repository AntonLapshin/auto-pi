/**
 * Clarification support for the auto-pi `/loop-seed` flow (M2).
 *
 * The primary path is *agentic*: `extensions/seed/agentic-clarify.js` runs a
 * fresh Pi persona that evaluates the specific project idea and generates the
 * follow-up questions that resolve its ambiguity. This module provides:
 *
 *   - `buildQuestions` — a minimal, idea-agnostic fallback question set used only
 *     when the agent cannot be run or its output is unusable (offline / non-
 *     interactive / LLM failure). It contains NO hardcoded topic questions; the
 *     only question /loop-seed always asks (the project name) lives in the
 *     command layer, not here.
 *   - `applyAnswers` — turns the question set + answers into the `clarification`
 *     record stored in initiation.json, with a "use assumptions" escape hatch.
 *
 * The module is UI-agnostic: it only decides *what* to ask. Asking is the
 * caller's job (the interactive `/loop-seed` command uses `ctx.ui`, the CLI fallback
 * uses readline), which keeps the logic testable and shared.
 *
 * Plain JS on purpose — shared between the interactive command and the CLI.
 */

/**
 * Question descriptor. `choices` is optional (a single-select), otherwise the
 * answer is free text.
 *
 * @typedef {Object} Question
 * @property {string} id          stable machine id (also the state key)
 * @property {string} prompt      human-ready question
 * @property {string[]} [choices] closed-ended options, first is default
 * @property {any} [assumption]   default used when the user picks "use assumptions"
 */

/**
 * Build the minimal fallback question set, used only when the agentic
 * clarifier produced nothing usable. These are deliberately idea-agnostic —
 * they never assume a topic, and they are few, so they never dominate a real
 * agent-generated set. The project name is not asked here: it is the command
 * layer's single hardcoded question.
 *
 * @param {string} description the raw `/loop-seed <description>` argument
 * @param {string} [projectName] the explicit project name, when provided (for nicer wording)
 * @returns {Question[]} 3–4 generic questions
 */
export function buildQuestions(description, projectName) {
	const name = () => {
		const explicit = String(projectName ?? "").trim();
		if (explicit) return explicit;
		const text = String(description ?? "").trim();
		return text || "the project";
	};

	// Guarantee 3 minimum, all idea-agnostic.
	return [
		{
			id: "interface",
			prompt: "How should users primarily interact with the project?",
			choices: ["Web app (browser)", "CLI tool", "Library / API", "Desktop"],
			assumption: "Web app (browser)",
		},
		{
			id: "scope",
			prompt: `What should the first version of "${name()}" actually do?`,
			assumption: "A minimal, focused slice",
		},
		{
			id: "constraints",
			prompt: `Any constraints, preferences, or requirements for "${name()}"? (framework, integrations, audience, deployment…)`,
			assumption: "None — use sensible defaults",
		},
	];
}

/**
 * Apply answers to the questions and produce the `clarification` record stored
 * in initiation.json. When a question's answer equals its first (default)
 * choice, we mark it `assumed` so later milestones know it may need revisiting.
 *
 * @param {Question[]} questions
 * @param {Record<string,string>} answers keyed by question.id
 * @param {boolean} usedAssumptions whether the escape hatch was used
 * @returns {object} { questions, answers, usedAssumptions }
 */
export function applyAnswers(questions, answers = {}, usedAssumptions = false) {
	const qa = questions.map((q) => {
		const value = answers[q.id] ?? q.assumption ?? "";
		return {
			id: q.id,
			prompt: q.prompt,
			choices: q.choices ?? [],
			answer: value,
			assumed: usedAssumptions || value === q.assumption,
		};
	});
	return {
		questions: qa,
		answers: Object.fromEntries(qa.map((q) => [q.id, q.answer])),
		usedAssumptions,
	};
}
