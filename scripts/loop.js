#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop` command (M6).
 *
 * Runs the infinite autonomous loop for the active project. This is the entry
 * launched under nohup during `/loop-seed`:
 *
 *   nohup node scripts/loop.js > .pi/logs/loop.out 2>&1 &
 *
 * It reuses the shared orchestrator core in `extensions/loop/orchestrator.js`
 * so the CLI and the interactive `/loop` command behave identically.
 *
 * Flags:
 *   --once        run a single cycle and exit (useful for debugging)
 *   --cycles N    run at most N cycles then exit
 *   --dry-run     scan + dispatch but do not launch a persona
 *   --help        show usage
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runLoop, runLoopCycle, readActiveProject } from "../extensions/loop/orchestrator.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
	return [
		"auto-pi loop — run the autonomous loop for the active project",
		"",
		"Usage:",
		"  node scripts/loop.js [--once] [--cycles N] [--dry-run]",
		"",
		"Flags:",
		"  --once       run a single cycle and exit",
		"  --cycles N   run at most N cycles then exit",
		"  --dry-run    scan + dispatch but do not launch a persona",
		"  --help       show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const once = argv.includes("--once");
	const dryRun = argv.includes("--dry-run");
	const cyclesArg = argv.find((a) => a.startsWith("--cycles=")) || null;
	const cycles = cyclesArg ? parseInt(cyclesArg.split("=")[1], 10) : undefined;

	const io = { log: (line) => process.stdout.write(`[loop] ${line}\n`) };

	// Resolve the active project workspace.
	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[loop] ${activeRes.error}\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;

	if (once) {
		const result = await runLoopCycle(workspace, io, { dryRun });
		process.stdout.write(result.message + "\n");
		process.exit(result.ok ? 0 : 1);
	}

	const opts = { dryRun };
	if (cycles) opts.cycles = cycles;
	const result = await runLoop(workspace, io, opts);
	process.stdout.write(`[loop] finished after ${result.cycles} cycle(s) (stopped=${result.stopped}).\n`);
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi loop] error: ${err?.stack || err}\n`);
	process.exit(2);
});
