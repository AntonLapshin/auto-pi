/**
 * Clarification for the auto-pi `/seed` flow (M2).
 *
 * Turns a one-line project description into 3–6 high-value clarifying questions
 * whose answers shape the scaffold, and supports a "use assumptions" escape
 * hatch so the flow can proceed automatically without human input.
 *
 * The module is UI-agnostic: it only decides *what* to ask. Asking is the
 * caller's job (the interactive `/seed` command uses `ctx.ui`, the CLI fallback
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
 * Build the question set for a project description.
 *
 * Questions are derived from what the description tells us (or fails to tell
 * us). Common gaps: target audience/platform, CLI vs GUI, persistence needs,
 * auth, deployment, and whether scaffolding should stay minimal.
 *
 * @param {string} description the raw `/seed <description>` argument
 * @returns {Question[]} 3–6 questions
 */
export function buildQuestions(description) {
	const text = String(description ?? "").trim().toLowerCase();
	const questions = [];

	// 1. Shape / interface — almost always ambiguous from a single sentence.
	if (/web|app|ui|cli|site|dashboard|tool/i.test(text)) {
		questions.push({
			id: "interface",
			prompt: "What is the primary interface for the project?",
			choices: ["Web app (browser)", "CLI tool", "Library / API", "Desktop"],
			assumption: "Web app (browser)",
		});
	} else {
		questions.push({
			id: "interface",
			prompt: "How should users primarily interact with this project?",
			choices: ["Web app (browser)", "CLI tool", "Library / API", "Desktop"],
			assumption: "Web app (browser)",
		});
	}

	// 2. Persistence — storage is a recurring requirement.
	if (/note|markdown|data|store|save|database|list|track|record/i.test(text)) {
		questions.push({
			id: "persistence",
			prompt: "Where should data be stored / persisted?",
			choices: ["Local (browser/device)", "Files on disk", "Server / cloud DB", "None yet"],
			assumption: "Files on disk",
		});
	} else {
		questions.push({
			id: "persistence",
			prompt: "Does the project need to persist any data between sessions?",
			choices: ["Yes — local storage", "Yes — server storage", "No"],
			assumption: "Yes — local storage",
		});
	}

	// 3. Users / auth — only relevant if it has users or a server.
	if (/note|app|site|dashboard|team|user|account|auth|login/i.test(text)) {
		questions.push({
			id: "auth",
			prompt: "Does the project need user accounts or authentication?",
			choices: ["No — single user / public", "Yes — simple auth", "Yes — full user accounts"],
			assumption: "No — single user / public",
		});
	} else if (/cli|library|api/i.test(text)) {
		questions.push({
			id: "auth",
			prompt: "Does the project need authentication (API keys, tokens)?",
			choices: ["No", "Yes — API tokens"],
			assumption: "No",
		});
	}

	// 4. Scope — keep it small enough for a single affordable slice.
	if (/note|todo|list|simple|basic/i.test(text)) {
		questions.push({
			id: "scope",
			prompt: "What scope should the first version target?",
			choices: ["Minimal viable slice", "Full feature set"],
			assumption: "Minimal viable slice",
		});
	}

	// 5. Deployment target (harness ships to GitHub Pages by default; clarify early).
	if (/web|app|site|dashboard|demo/i.test(text) && !/api|library|cli/i.test(text)) {
		questions.push({
			id: "deploy",
			prompt: "Should the project be deployable as a live demo (GitHub Pages)?",
			choices: ["Yes", "No"],
			assumption: "Yes",
		});
	}

	// 6. Language details — only when ambiguous (mostly web).
	if (/app|web|site|dashboard|tool/i.test(text)) {
		questions.push({
			id: "language",
			prompt: "Any language or framework preference?",
			choices: ["No preference (use default React + TypeScript)", "Prefer something else (describe in answer)"],
			assumption: "No preference (use default React + TypeScript)",
		});
	}

	// Guarantee 3 minimum.
	while (questions.length < 3) {
		questions.push({
			id: `extra-${questions.length + 1}`,
			prompt: `Any other requirement or constraint for "${String(description ?? "").trim() || "the project"}"?`,
			choices: ["None", "Protocol / dependencies / team size constraints"],
			assumption: "None",
		});
	}

	// Cap at 6.
	return questions.slice(0, 6);
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
