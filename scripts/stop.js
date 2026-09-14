#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-stop` command (M6).
 *
 * Kills the autonomous loop for the active project instantly (SIGKILL — no
 * graceful cycle-boundary wait) and writes the stop file so the project stays
 * paused until resumed. Also clears a stale loop lock if one is left behind.
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
import { readActiveProject, stopLoopInstantly } from "../extensions/loop/orchestrator.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[stop] ${activeRes.error}\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;
	const io = { log: (line) => process.stdout.write(`[stop] ${line}\n`) };
	const result = await stopLoopInstantly(workspace, io);
	process.stdout.write(`[stop] ${result.message}\n`);
	// Stopping only pauses the loop. The active-project record is preserved so
	// the project can be resumed (/loop-resume) or restarted (/loop-restart)
	// anytime; /loop-switch moves to another project.
	const who = activeRes.active.repo || activeRes.active.projectName || workspace;
	process.stdout.write(`[stop] Project "${who}" remains active — resume with /loop-resume, restart with /loop-restart, or switch with /loop-switch.\n`);
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi stop] error: ${err?.stack || err}\n`);
	process.exit(2);
});
