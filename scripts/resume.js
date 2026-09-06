#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-resume` command (M13).
 *
 * Resumes a stopped/paused project's loop: removes the stop marker and starts
 * the loop (if not already running).
 *
 *   npm run resume            # resume the active project's loop
 *   npm run resume -- --once  # resume and run a single cycle (debug)
 *
 * Flags:
 *   --once   run a single cycle instead of starting the infinite loop
 *   --help   show usage
 *
 * Shares its stop-file handling with the interactive `/loop-resume` slash
 * command (`extensions/harness.ts`) via `extensions/loop/log-helpers.js`.
 *
 * Exit codes: 0 ok · 1 operational failure (no active project / cycle failed) ·
 * 2 usage/config error.
 */

import { readActiveProject, checkLock, startLoopDetached } from "../extensions/loop/orchestrator.js";
import { removeStopFile } from "../extensions/loop/log-helpers.js";
import { EXIT_OK, EXIT_OPERATIONAL, EXIT_USAGE } from "../extensions/loop/result.js";

function usage() {
	return [
		"auto-pi resume — resume a stopped/paused project's loop",
		"",
		"Usage:",
		"  node scripts/resume.js [--once]",
		"",
		"Flags:",
		"  --once   run a single cycle and exit (debug)",
		"  --help   show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(EXIT_OK);
	}
	const once = argv.includes("--once");

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[auto-pi:resume] ${activeRes.error}\n`);
		process.stderr.write(`[auto-pi:resume] Use /loop-seed (npm run seed) to start a new project.\n`);
		process.exit(EXIT_OPERATIONAL);
	}
	const workspace = activeRes.active.workspace;

	// Remove the stop file (best-effort, never throws).
	await removeStopFile(workspace);
	process.stdout.write(`[auto-pi:resume] stop marker removed.\n`);

	if (once) {
		const { runLoopCycle } = await import("../extensions/loop/orchestrator.js");
		const result = await runLoopCycle(workspace, {
			log: (line) => process.stdout.write(`[loop] ${line}\n`),
		});
		process.stdout.write(result.message + "\n");
		process.exit(result.ok ? EXIT_OK : EXIT_OPERATIONAL);
	}

	// If a loop is already running, just report.
	const lock = await checkLock(workspace);
	if (lock.locked) {
		process.stdout.write(`[auto-pi:resume] a loop is already running (PID ${lock.pid}); it will continue.\n`);
		process.exit(EXIT_OK);
	}

	// Start the loop detached (shared `startLoopDetached` — same setsid/nohup
	// launch with provider/model propagation as /loop-seed, /loop-pull,
	// /loop-resume and /loop-restart).
	const started = await startLoopDetached(workspace);
	if (!started.ok) {
		process.stderr.write(`[auto-pi:resume] could not start the loop: ${started.message}\n`);
		process.exit(EXIT_OPERATIONAL);
	}
	process.stdout.write(`[auto-pi:resume] loop started (PID ${started.pid || "?"}); log: .pi/logs/loop.out\n`);
	process.exit(EXIT_OK);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi:resume] error: ${err?.stack || err}\n`);
	process.exit(EXIT_USAGE);
});
