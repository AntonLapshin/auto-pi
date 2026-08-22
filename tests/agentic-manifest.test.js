/**
 * Agentic manifest generation tests.
 *
 * Covers the post-clarification LLM step that turns the idea + the user's
 * clarification answers into the project's `manifest.md` with a milestone
 * roadmap (the backbone of the project the PM plans against):
 *   - the spawned `pi` argument list generated for the architect session
 *   - building the task from the idea + clarification answers
 *   - parsing/normalizing the agent's JSON manifest output (markers, free-form
 *     fallback, sanitization, milestone count range)
 *   - rendering the normalized manifest into `manifest.md` markdown
 *   - `agenticManifest` end-to-end with an injected executor: agent success,
 *     fallback on non-zero exit, fallback on unusable/prose-only output, and
 *     fallback when fewer than the minimum milestones are returned
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	agenticManifest,
	buildManifestArgs,
	buildManifestTask,
	extractManifestJson,
	normalizeManifest,
	renderManifest,
} from "../extensions/seed/agentic-manifest.js";

const OPEN = "%%MANIFEST_JSON_BEGIN%%";
const CLOSE = "%%MANIFEST_JSON_END%%";

/** A valid 3-milestone manifest payload. */
function goodPayload() {
	return {
		purpose: "A kingdoms strategy game",
		goals: ["Deliver a playable game", "Keep core logic pure and tested"],
		nonGoals: ["No multiplayer in v1"],
		successCriteria: ["npm test passes", "Demo deployed"],
		milestones: [
			{ id: "M1", title: "Foundation", goal: "Stand up the game", scope: ["Board", "Turn logic"] },
			{ id: "M2", title: "Core gameplay", goal: "Playable round", scope: ["Units", "Combat"] },
			{ id: "M3", title: "Polish", goal: "Shippable", scope: ["UI", "Balance"] },
		],
	};
}

// --- buildManifestTask / buildManifestArgs ---

test("buildManifestTask includes the idea, name, and clarification answers", () => {
	const task = buildManifestTask({
		description: "Build a kingdoms strategy game",
		projectName: "Kingdoms",
		clarification: { answers: { audience: "gamers", scope: "multiplayer" } },
	});
	assert.match(task, /Kingdoms/);
	assert.match(task, /Build a kingdoms strategy game/);
	assert.match(task, /gamers/);
	assert.match(task, /multiplayer/);
});

test("buildManifestTask tolerates missing clarification answers", () => {
	const task = buildManifestTask({ description: "x", projectName: "X", clarification: {} });
	assert.match(task, /- \(none — using assumptions\)/);
});

test("buildManifestArgs: batch pi flags + provider/model", () => {
	const args = buildManifestArgs({
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
	const promptIdx = args.indexOf("--append-system-prompt");
	assert.ok(promptIdx !== -1);
	// The architect prompt must instruct producing a milestone roadmap.
	assert.match(args[promptIdx + 1], /milestone/);
});

// --- extractManifestJson ---

test("extractManifestJson: parses marker-wrapped JSON", () => {
	const out = `ignored prose\n${OPEN}\n{"purpose":"p"}\n${CLOSE}\nmore`;
	assert.deepEqual(extractManifestJson(out), { purpose: "p" });
});

test("extractManifestJson: falls back to bare JSON object when no markers", () => {
	const out = `Here: {"purpose":"p"} thanks!`;
	assert.deepEqual(extractManifestJson(out), { purpose: "p" });
});

test("extractManifestJson: returns null on garbage", () => {
	assert.equal(extractManifestJson("no json here"), null);
	assert.equal(extractManifestJson(""), null);
});

// --- normalizeManifest ---

test("normalizeManifest: converts a valid payload to canonical shape", () => {
	const norm = normalizeManifest(goodPayload());
	assert.ok(norm);
	assert.equal(norm.purpose, "A kingdoms strategy game");
	assert.equal(norm.goals.length, 2);
	assert.equal(norm.successCriteria.length, 2);
	assert.equal(norm.milestones.length, 3);
	assert.equal(norm.milestones[0].id, "M1");
	assert.deepEqual(norm.milestones[0].scope, ["Board", "Turn logic"]);
});

test("normalizeManifest: returns null for unusable payloads", () => {
	assert.equal(normalizeManifest(null), null);
	assert.equal(normalizeManifest({}), null);
	assert.equal(normalizeManifest({ purpose: "p", goals: [] }), null);
	assert.equal(normalizeManifest({ purpose: "p", goals: ["g"], successCriteria: ["c"] }), null); // no milestones
});

test("normalizeManifest: rejects fewer than the minimum milestones", () => {
	const p = goodPayload();
	p.milestones = p.milestones.slice(0, 2); // only M1, M2
	assert.equal(normalizeManifest(p), null);
});

test("normalizeManifest: drops malformed milestones and caps at max", () => {
	const p = goodPayload();
	// Append a malformed milestone (no scope) + a duplicate id + a non-M id.
	p.milestones.push({ id: "M4", title: "bad", goal: "no scope" });
	p.milestones.push({ id: "M1", title: "dup", goal: "g", scope: ["x"] });
	p.milestones.push({ id: "X9", title: "bad id", goal: "g", scope: ["x"] });
	const norm = normalizeManifest(p);
	assert.ok(norm);
	assert.equal(norm.milestones.length, 3); // only the 3 valid ones survive
});

// --- renderManifest ---

test("renderManifest: produces manifest.md markdown with milestones", () => {
	const norm = normalizeManifest(goodPayload());
	const md = renderManifest(norm, { projectName: "Kingdoms", description: "desc" });
	assert.match(md, /# Kingdoms — Manifest/);
	assert.match(md, /## Purpose/);
	assert.match(md, /## Goals/);
	assert.match(md, /## Non-goals/);
	assert.match(md, /## Success criteria/);
	assert.match(md, /## Milestones/);
	assert.match(md, /### M1 — Foundation/);
	assert.match(md, /### M2 — Core gameplay/);
	assert.match(md, /### M3 — Polish/);
	assert.match(md, /- \[ \] npm test passes/);
});

// --- agenticManifest end-to-end with injected executor ---

test("agenticManifest: returns agent manifest + markdown on success", async () => {
	const out = `${OPEN}\n${JSON.stringify(goodPayload())}\n${CLOSE}`;
	const res = await agenticManifest({
		description: "A kingdoms game",
		projectName: "Kingdoms",
		clarification: { answers: { audience: "gamers" } },
		execute: async () => ({ exitCode: 0, stdout: out, stderr: "" }),
	});
	assert.equal(res.ok, true);
	assert.equal(res.source, "agent");
	assert.equal(res.manifest.milestones.length, 3);
	assert.match(res.markdown, /### M1 — Foundation/);
	assert.ok(res.rawOutput.includes(OPEN));
});

test("agenticManifest: falls back on non-zero exit", async () => {
	const res = await agenticManifest({
		description: "x",
		execute: async () => ({ exitCode: 1, stdout: "", stderr: "provider error" }),
	});
	assert.equal(res.ok, false);
	assert.equal(res.source, "fallback");
});

test("agenticManifest: falls back when output is prose-only / unparseable", async () => {
	const res = await agenticManifest({
		description: "x",
		execute: async () => ({ exitCode: 0, stdout: "I would build a game with milestones.", stderr: "" }),
	});
	assert.equal(res.ok, false);
	assert.equal(res.source, "fallback");
});

test("agenticManifest: falls back when fewer than minimum milestones returned", async () => {
	const p = goodPayload();
	p.milestones = p.milestones.slice(0, 1);
	const out = `${OPEN}\n${JSON.stringify(p)}\n${CLOSE}`;
	const res = await agenticManifest({
		description: "x",
		execute: async () => ({ exitCode: 0, stdout: out, stderr: "" }),
	});
	assert.equal(res.ok, false);
	assert.equal(res.source, "fallback");
});

test("agenticManifest: falls back when executor throws", async () => {
	const res = await agenticManifest({
		description: "x",
		execute: async () => { throw new Error("boom"); },
	});
	assert.equal(res.ok, false);
	assert.equal(res.source, "fallback");
});
