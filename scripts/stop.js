#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-stop` command (M6).
 *
 * Pauses the autonomous loop for the active project by writing the stop file
 * (plan.md §13.3). The loop process checks for this file every cycle and exits
 * cleanly. Also releases the loop lock if it is stale.
 *
 * Stopping only pauses the loop — the active-project record is preserved so the
 * same project can be resumed (/loop-resume) or restarted (/loop-restart)
 * anytime. Use /loop-switch (npm run switch) to move to another project.
 *
 * Reuses the shared orchestrator helpers so the CLI and the interactive
 * `/loop-stop` command behave identically.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readActiveProject, writeStopFile } from "../extensions/loop/orchestrator.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[stop] ${activeRes.error}\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;
	const stopFile = await writeStopFile(workspace);
	process.stdout.write(`[stop] Stop file written: ${stopFile}\n`);
	process.stdout.write(`[stop] The loop will exit at the next cycle (or clean up a stale lock).\n`);
	// Stopping only pauses the loop. The active-project record is preserved so
	// the project can be resumed (/loop-resume) or restarted (/loop-restart)
	// anytime; /loop-switch moves to another project.
	const who = activeRes.active.repo || activeRes.active.projectName || workspace;
	process.stdout.write(`[stop] Project "${who}" remains active — resume with /loop-resume, restart with /loop-restart, or switch with /loop-switch.\n`);
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi stop] error: ${err?.stack || err}\n`);
	process.exit(2);
});
