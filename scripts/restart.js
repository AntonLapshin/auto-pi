#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-restart` command.
 *
 * Safely restarts the autonomous loop for the active project: writes the stop
 * file so the running loop (if any) exits at its next cycle boundary — letting
 * any in-flight persona finish — waits for it to actually exit, removes the
 * stop marker, and starts a fresh loop detached.
 *
 * Unlike `/loop-stop`, the active-project record is preserved, so the restarted
 * loop resumes the same project.
 *
 *   npm run restart            # restart the active project's loop
 *   npm run restart -- --timeout 120  # wait up to 120s for the old loop to exit
 *
 * Flags:
 *   --timeout N   seconds to wait for the running loop to exit (default 60)
 *   --help        show usage
 *
 * Exit codes: 0 ok · 1 operational failure (no active project, restart
 * failed, or timed out waiting for the old loop — it was asked to stop and
 * will exit on its own; run again shortly) · 2 usage/config error.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readActiveProject, restartLoop } from "../extensions/loop/orchestrator.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
	return [
		"auto-pi restart — safely restart the active project's autonomous loop",
		"",
		"Usage:",
		"  node scripts/restart.js [--timeout N]",
		"",
		"Flags:",
		"  --timeout N   seconds to wait for the running loop to exit (default 60)",
		"  --help        show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const timeoutMatch = argv.find((a) => a.startsWith("--timeout=")) || null;
	const timeoutSec = timeoutMatch ? parseInt(timeoutMatch.split("=")[1], 10) : undefined;

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[auto-pi:restart] ${activeRes.error}\n`);
		process.stderr.write(`[auto-pi:restart] Use /loop-seed (npm run seed) to start a new project.\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;

	const io = { log: (line) => process.stdout.write(`[auto-pi:restart] ${line}\n`) };
	const result = await restartLoop(workspace, { timeoutMs: timeoutSec ? timeoutSec * 1000 : undefined, ...io });
	process.stdout.write(result.message + "\n");
	// A timeout is an operational failure (exit 1), not a usage error: the old
	// loop was asked to stop and will exit on its own.
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi:restart] error: ${err?.stack || err}\n`);
	process.exit(2);
});
