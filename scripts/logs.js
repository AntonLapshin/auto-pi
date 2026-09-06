#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-logs` command (M13).
 *
 * Shows the latest local loop / run logs for the active project.
 *
 *   npm run logs                # last 40 lines of the preferred log
 *   npm run logs -- --tail 100  # last 100 lines
 *
 * Flags:
 *   --tail N   number of lines to show (default 40)
 *   --help     show usage
 *
 * Shares its logic with the interactive `/loop-logs` slash command
 * (`extensions/harness.ts`) via `extensions/loop/log-helpers.js`, so the CLI
 * and the interactive command report identical results.
 *
 * Exit codes: 0 ok · 1 operational failure (no active project / no logs) ·
 * 2 usage/config error. Note: the interactive `/loop-logs` reports "no logs
 * yet" as an info notification instead of a failure — the CLI exits 1 so
 * scripts can detect the empty case.
 */

import { readActiveProject } from "../extensions/loop/orchestrator.js";
import { parseTailArg, readTailLog } from "../extensions/loop/log-helpers.js";
import { EXIT_OK, EXIT_OPERATIONAL, EXIT_USAGE } from "../extensions/loop/result.js";

function usage() {
	return [
		"auto-pi logs — show the latest local logs for the active project",
		"",
		"Usage:",
		"  node scripts/logs.js [--tail N]",
		"",
		"Flags:",
		"  --tail N   number of lines to show (default 40)",
		"  --help     show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(EXIT_OK);
	}
	const tail = parseTailArg(argv);

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[auto-pi:logs] ${activeRes.error}\n`);
		process.exit(EXIT_OPERATIONAL);
	}
	const workspace = activeRes.active.workspace;

	const res = await readTailLog(workspace, tail);
	if (!res.ok) {
		process.stderr.write(`[auto-pi:logs] ${res.error}\n`);
		process.exit(EXIT_OPERATIONAL);
	}

	process.stdout.write(`[auto-pi:logs] ${res.file} (last ${Math.min(tail, res.totalLines)} of ${res.totalLines} lines)\n`);
	process.stdout.write((res.text || "") + "\n");
	process.exit(EXIT_OK);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi:logs] error: ${err?.stack || err}\n`);
	process.exit(EXIT_USAGE);
});
