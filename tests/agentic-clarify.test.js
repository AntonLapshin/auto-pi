/**
 * Agentic clarification tests (M2).
 *
 * Covers the new agentic `/loop-seed` clarification path:
 *   - the spawned `pi` argument list generated for the clarifier session
 *   - parsing/normalizing the agent's JSON output into the canonical Question[]
 *     shape (markers, free-form fallback, sanitization, reserved ids, range)
 *   - `agenticClarify` end-to-end with an injected executor: agent success,
 *     fallback on non-zero exit, fallback on unusable/prose-only output, and
 *     fallback when fewer than the minimum questions are returned
 *   - the static fallback question set is idea-agnostic (contains no topic
 *     questions and never asks for the project name)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	agenticClarify,
	buildClarifyArgs,
	buildClarifyTask,
	extractQuestionsJson,
	normalizeQuestions,
} from "../extensions/seed/agentic-clarify.js";
import { buildQuestions, applyAnswers } from "../extensions/seed/clarify.js";

const OPEN = "%%QUESTIONS_JSON_BEGIN%%";
const CLOSE = "%%QUESTIONS_JSON_END%%";

// --- buildClarifyTask / buildClarifyArgs ---

test("buildClarifyTask includes the idea and project name", () => {
	const task = buildClarifyTask({ description: "Build a markdown notes app", projectName: "Notes" });
	assert.match(task, /Build a markdown notes app/);
	assert.match(task, /Notes/);
});

test("buildClarifyArgs: batch pi flags + provider/model, no project-name question", () => {
	const args = buildClarifyArgs({
		task: "t",
		config: { pi: { provider: "openai", model: "gpt-4o" } },
	});
	assert.ok(args.includes("-p"));
	assert.ok(args.includes("--no-session"));
	assert.ok(args.includes("--mode"));
	assert.ok(args.includes("text"));
	assert.ok(args.includes("--append-system-prompt"));
	assert.ok(args.includes("--exclude-tools"));
	assert.ok(args.includes("--provider"));
	assert.ok(args.includes("openai"));
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("gpt-4o"));
	// The clarifier prompt must explicitly forbid asking the project name.
	const promptIdx = args.indexOf("--append-system-prompt");
	assert.ok(promptIdx !== -1);
	assert.match(args[promptIdx + 1], /Do NOT ask for the project name/);
});

// --- extractQuestionsJson ---

test("extractQuestionsJson: parses marker-wrapped JSON", () => {
	const out = `ignored prose\n${OPEN}\n{"questions":[{"id":"a"}]}\n${CLOSE}\nmore`;
	const payload = extractQuestionsJson(out);
	assert.deepEqual(payload, { questions: [{ id: "a" }] });
});

test("extractQuestionsJson: falls back to bare JSON object when no markers", () => {
	const out = `Here are the questions: {"questions":[{"id":"a"}]} thanks!`;
	const payload = extractQuestionsJson(out);
	assert.deepEqual(payload, { questions: [{ id: "a" }] });
});

test("extractQuestionsJson: returns null on garbage", () => {
	assert.equal(extractQuestionsJson("no json here"), null);
	assert.equal(extractQuestionsJson(""), null);
});

// --- normalizeQuestions / sanitization ---

test("normalizeQuestions: converts raw entries to canonical shape with defaults", () => {
	const payload = {
		questions: [
			{ id: "audience", prompt: "Who is it for?", choices: ["Devs", "Consumers"], assumption: "Devs" },
			{ id: "Ui", prompt: "Any UI?", choices: [] },
			{ id: "3", prompt: "Open ended?", assumption: "anything" },
			{ id: "name", prompt: "What is the project name?" }, // reserved -> dropped
			{ id: "audience", prompt: "duplicate id -> dropped" }, // dup -> dropped
		],
	};
	const qs = normalizeQuestions(payload);
	assert.equal(qs.length, 3);
	assert.equal(qs[0].id, "audience");
	assert.equal(qs[0].choices.length, 2);
	assert.equal(qs[0].assumption, "Devs");
	// Choices are defaulted from the first choice when assumption omitted.
	assert.equal(qs[1].id, "ui");
	assert.deepEqual(qs[1].choices, []);
	assert.equal(qs[1].assumption, "");
	// Missing choices/default -> free text.
	assert.equal(qs[2].id, "3");
	assert.deepEqual(qs[2].choices, []);
	assert.equal(qs[2].assumption, "anything");
});

test("normalizeQuestions: single-element choices become free text", () => {
	const payload = {
		questions: [
			{ id: "a", prompt: "Pick one", choices: ["Only option"], assumption: undefined },
		],
	};
	const qs = normalizeQuestions(payload);
	assert.equal(qs.length, 1);
	assert.deepEqual(qs[0].choices, []);
	assert.equal(qs[0].assumption, "");
});

test("normalizeQuestions: returns [] for unusable payloads", () => {
	assert.deepEqual(normalizeQuestions(null), []);
	assert.deepEqual(normalizeQuestions({}), []);
	assert.deepEqual(normalizeQuestions({ questions: "nope" }), []);
	assert.deepEqual(normalizeQuestions({ questions: [{ id: "x" }] }), []);
});

test("normalizeQuestions: caps at MAX (6)", () => {
	const payload = { questions: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, prompt: `Q${i}` })) };
	const qs = normalizeQuestions(payload);
	assert.equal(qs.length, 6);
});

// --- agenticClarify end-to-end with injected executor ---

test("agenticClarify: returns agent questions on success", async () => {
	const out = `${OPEN}\n{"questions":[${[
		'{"id":"audience","prompt":"Who?","choices":["Devs","Consumers"],"assumption":"Devs"}',
		'{"id":"storage","prompt":"Store where?","choices":["Local","Cloud"],"assumption":"Local"}',
		'{"id":"extra","prompt":"Anything else?","assumption":"No"}',
	].join(",")}]}\n${CLOSE}`;
	const res = await agenticClarify({
		description: "A notes app",
		projectName: "Notes",
		execute: async () => ({ exitCode: 0, stdout: out, stderr: "" }),
	});
	assert.equal(res.questionSource, "agent");
	assert.equal(res.questions.length, 3);
	assert.equal(res.questions[0].id, "audience");
	assert.equal(res.rawOutput.includes(OPEN), true);
});

test("agenticClarify: falls back on non-zero exit", async () => {
	const res = await agenticClarify({
		description: "x",
		execute: async () => ({ exitCode: 1, stdout: "", stderr: "provider error" }),
	});
	assert.equal(res.questionSource, "fallback");
	assert.ok(res.questions.length >= 3);
});

test("agenticClarify: falls back when output is prose-only / unparseable", async () => {
	const res = await agenticClarify({
		description: "x",
		execute: async () => ({ exitCode: 0, stdout: "I would ask about the users and the interface.", stderr: "" }),
	});
	assert.equal(res.questionSource, "fallback");
	assert.ok(res.questions.length >= 3);
});

test("agenticClarify: falls back when fewer than minimum questions returned", async () => {
	const out = `${OPEN}\n{"questions":[{"id":"only","prompt":"Only one"}]}\n${CLOSE}`;
	const res = await agenticClarify({
		description: "x",
		execute: async () => ({ exitCode: 0, stdout: out, stderr: "" }),
	});
	assert.equal(res.questionSource, "fallback");
	assert.ok(res.questions.length >= 3);
});

test("agenticClarify: falls back when executor throws", async () => {
	const res = await agenticClarify({
		description: "x",
		execute: async () => { throw new Error("boom"); },
	});
	assert.equal(res.questionSource, "fallback");
	assert.ok(res.questions.length >= 3);
});

// --- static fallback question set ---

test("buildQuestions: idea-agnostic, no project-name question, >=3 entries", () => {
	const qs = buildQuestions("Build a notes app");
	assert.ok(qs.length >= 3);
	for (const q of qs) {
		assert.ok(q.id && q.prompt);
		assert.ok(q.id !== "name" && q.id !== "project", "must never ask the project name");
	}
});

test("applyAnswers still produces the clarification record with assumptions", () => {
	const questions = buildQuestions("Build a notes app");
	const clarification = applyAnswers(questions, {}, true);
	assert.equal(clarification.usedAssumptions, true);
	assert.equal(clarification.questions.length, questions.length);
	assert.ok(clarification.questions.every((q) => q.assumed === true));
	assert.equal(clarification.answers[questions[0].id], questions[0].assumption);
});
