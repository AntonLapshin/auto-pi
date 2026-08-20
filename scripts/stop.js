#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/stop` command (M6).
 *
 * Stops the autonomous loop for the active project by writing the stop file
 * (plan.md §13.3). The loop process checks for this file every cycle and exits
 * cleanly. Also releases the loop lock if it is stale.
 *
 * Reuses the shared orchestrator helpers so the CLI and the interactive
 * `/stop` command behave identically.
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
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi stop] error: ${err?.stack || err}\n`);
	process.exit(2);
});
