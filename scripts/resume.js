#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/resume` command (M13).
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
 */

import { join } from "node:path";
import { rm } from "node:fs/promises";
import { readActiveProject, checkLock } from "../extensions/loop/orchestrator.js";

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
		process.exit(0);
	}
	const once = argv.includes("--once");

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[resume] ${activeRes.error}\n`);
		process.stderr.write(`[resume] Use /loop-seed (npm run seed) to start a new project.\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;

	// Remove the stop file.
	const stopFile = join(workspace, ".pi", "state", "stop");
	try {
		await rm(stopFile, { force: true });
		process.stdout.write(`[resume] stop marker removed.\n`);
	} catch {
		// best-effort
	}

	if (once) {
		const { runLoopCycle } = await import("../extensions/loop/orchestrator.js");
		const result = await runLoopCycle(workspace, {
			log: (line) => process.stdout.write(`[loop] ${line}\n`),
		});
		process.stdout.write(result.message + "\n");
		process.exit(result.ok ? 0 : 1);
	}

	// If a loop is already running, just report.
	const lock = await checkLock(workspace);
	if (lock.locked) {
		process.stdout.write(`[resume] a loop is already running (PID ${lock.pid}); it will continue.\n`);
		process.exit(0);
	}

	// Start the loop detached under nohup. `setsid` puts the loop in its own
	// session/process group with no controlling terminal so spawned persona `pi`
	// sessions never inherit the interactive tty (which hangs them in batch
	// mode); stdin is redirected from /dev/null so the loop never reads the
	// shared tty.
	const { execa } = await import("execa");
	const script = join(process.cwd(), "scripts", "loop.js");
	const logFile = join(workspace, ".pi", "logs", "loop.out");
	const shell = await execa("bash", ["-c", `setsid nohup node "${script}" </dev/null > "${logFile}" 2>&1 & echo $!`], {
		cwd: workspace,
		reject: false,
	});
	const pid = parseInt((shell.stdout || "").trim(), 10);
	process.stdout.write(`[resume] loop started (PID ${pid || "?"}); log: .pi/logs/loop.out\n`);
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi resume] error: ${err?.stack || err}\n`);
	process.exit(2);
});
