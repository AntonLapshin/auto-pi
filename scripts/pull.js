#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-pull` command.
 *
 * Pulls an existing auto-pi project from a GitHub repo onto this machine so it
 * can be continued here exactly as if it had been seeded locally. This is the
 * "continue on a different machine" companion to `/loop-seed`:
 *
 *   npm run pull -- https://github.com/AntonLapshin/ape-kingdom
 *
 * It clones the repo into the same `~/.auto-pi/workspaces/{owner}/{repo}/repo`
 * layout `/loop-seed` uses, verifies it is an auto-pi project (committed
 * `.pi/config.json`), recreates the git-ignored `.pi/state/initiation.json`
 * marker (so `/loop-switch` and the loop-recognition helpers see it as a
 * locally-seeded project), records it as the active project, and starts the
 * loop.
 *
 * Flags:
 *   --no-start   pull + record the active project but do not start the loop
 *   --yes        skip the confirmation prompt
 *   --help       show usage
 */

import { runPull } from "../extensions/pull/core.js";

function usage() {
	return [
		"auto-pi pull — pull an existing auto-pi project from a GitHub repo onto this machine",
		"",
		"Usage:",
		"  node scripts/pull.js <github-repo-url-or-owner/repo> [--no-start] [--yes]",
		"",
		"Args:",
		"  <github-repo-url-or-owner/repo>  e.g. https://github.com/AntonLapshin/ape-kingdom",
		"",
		"Flags:",
		"  --no-start   pull + record the active project but do not start the loop",
		"  --yes        skip the confirmation prompt",
		"  --help       show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const noStart = argv.includes("--no-start");
	const assume = argv.includes("--yes");
	const ref = argv.find((a) => !a.startsWith("--"));

	if (!ref) {
		process.stderr.write("[pull] Usage: node scripts/pull.js <github-repo-url-or-owner/repo> [--no-start] [--yes]\n");
		process.exit(1);
	}

	const io = {
		notify: (text) => process.stdout.write(`[pull] ${text}\n`),
		confirmPull: async (repo) => {
			if (assume) return true;
			process.stdout.write(`Pull ${repo} onto this machine and start the loop? [yes/no]: `);
			const { createInterface } = await import("node:readline");
			const { stdin, stdout } = await import("node:process");
			const rl = createInterface({ input: stdin, output: stdout });
			const answer = await new Promise((resolve) => rl.question("", resolve));
			rl.close();
			return /^y(es)?$/i.test(answer.trim());
		},
	};

	const result = await runPull(ref, io, { startLoop: !noStart });
	process.stdout.write(`\n${result.message}\n`);
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi pull] error: ${err?.stack || err}\n`);
	process.exit(2);
});
