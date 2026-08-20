#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-seed` command (M2).
 *
 * Runs the same initiation flow as the interactive `/loop-seed` command, reusing the
 * shared core in `extensions/seed/core.js`. Suitable for `npm run seed` outside
 * an interactive Pi session.
 *
 *   npm run seed -- "Build a markdown notes app"      # interactive prompts (incl. project name)
 *   npm run seed -- "Build a markdown notes app" --yes # non-interactive (assumptions)
 *
 * Flags:
 *   --yes / --assume   skip confirmation & clarification, use assumptions
 *   --help             show usage
 */

import { createInterface } from "node:readline";
import { runSeed } from "../extensions/seed/core.js";

function usage() {
	return [
		"auto-pi seed — initiate a new project",
		"",
		"Usage:",
		"  npm run seed -- \"<project description>\" [--yes]",
		"",
		"Args:",
		"  <project description>  one-line idea used for clarification + repo naming",
		"  --yes (or --assume)    skip prompts, proceed with assumptions",
		"",
		"Interactively, you'll also be asked for an explicit project name (used for",
		"the repo slug and display name).",
		"",
		"Examples:",
		"  npm run seed -- \"Build a markdown notes app\"",
		"  npm run seed -- \"Build a markdown notes app\" --yes",
	].join("\n");
}

function ask(question, choices) {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		if (choices && choices.length) {
			rl.question(`${question} [${choices[0]}]: `, (answer) => {
				rl.close();
				const trimmed = answer.trim();
				resolve(trimmed === "" ? choices[0] : choices.find((c) => c.toLowerCase() === trimmed.toLowerCase()) || trimmed);
			});
		} else {
			rl.question(`${question}: `, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		}
	});
}

async function run(description, projectName, assume) {
	const io = {
		notify: (text) => process.stdout.write(`[seed] ${text}\n`),
		askQuestions: async (questions) => {
			if (assume) return { usedAssumptions: true };
			process.stdout.write("\n--- Clarification (answer or press Enter for the default; type 'use assumptions' to skip) ---\n");
			const answers = {};
			let usedAssumptions = false;
			for (const q of questions) {
				const value = await ask(q.prompt, q.choices);
				if (/^\s*use\s+assumptions\s*$/i.test(value)) {
					usedAssumptions = true;
					break;
				}
				answers[q.id] = value;
			}
			if (usedAssumptions) return { usedAssumptions: true };
			return answers;
		},
		confirmRepo: async (repo, visibility) => {
			if (assume) return true;
			const value = await ask(
				`Create ${visibility} GitHub repo ${repo}?`,
				["yes", "no"],
			);
			return /^y(es)?$/i.test(value) || value === "yes";
		},
		chooseRepo: async (candidates) => {
			if (assume) return candidates[0];
			return ask(`Repo name taken. Choose one: ${candidates.join(", ")}`, candidates);
		},
	};

	const result = await runSeed(description, io, { projectName });
	process.stdout.write(`\n${result.message}\n`);
	process.exit(result.ok ? 0 : 1);
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const assume = argv.includes("--yes") || argv.includes("--assume");
	const descriptionArg = argv.find((a) => !a.startsWith("--")) || "";
	const description = descriptionArg || (assume ? "" : await ask("Project description", undefined));
	// Ask for the project name explicitly (unless --yes / --assume).
	const projectName = assume ? "" : await ask("Project name (used for the repo slug)", description || "my-project");
	await run(description, projectName, assume);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi seed] error: ${err?.stack || err}\n`);
	process.exit(2);
});
