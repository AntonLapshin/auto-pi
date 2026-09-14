#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-restart` command.
 *
 * Restarts the autonomous loop for the active project instantly: SIGKILLs the
 * running loop (if any) with no graceful cycle-boundary wait — an in-flight
 * persona is terminated immediately — then starts a fresh loop detached.
 *
 * Unlike `/loop-stop`, the active-project record is preserved, so the restarted
 * loop resumes the same project.
 *
 *   npm run restart            # restart the active project's loop
 *
 * Exit codes: 0 ok · 1 operational failure (no active project or restart
 * failed) · 2 usage/config error.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readActiveProject, restartLoop } from "../extensions/loop/orchestrator.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
	return [
		"auto-pi restart — instantly restart the active project's autonomous loop",
		"",
		"Usage:",
		"  node scripts/restart.js",
		"",
		"Flags:",
		"  --help        show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[auto-pi:restart] ${activeRes.error}\n`);
		process.stderr.write(`[auto-pi:restart] Use /loop-seed (npm run seed) to start a new project.\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;

	const io = { log: (line) => process.stdout.write(`[auto-pi:restart] ${line}\n`) };
	const result = await restartLoop(workspace, io);
	process.stdout.write(result.message + "\n");
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi:restart] error: ${err?.stack || err}\n`);
	process.exit(2);
});
