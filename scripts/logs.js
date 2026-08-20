#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/logs` command (M13).
 *
 * Shows the latest local loop / run logs for the active project.
 *
 *   npm run logs                # last 40 lines of the preferred log
 *   npm run logs -- --tail 100  # last 100 lines
 *
 * Flags:
 *   --tail N   number of lines to show (default 40)
 *   --help     show usage
 */

import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { readActiveProject } from "../extensions/loop/orchestrator.js";

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
		process.exit(0);
	}
	const tailArg = argv.find((a) => a.startsWith("--tail="))?.slice("--tail=".length);
	const tail = tailArg ? parseInt(tailArg, 10) : 40;

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[logs] ${activeRes.error}\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;
	const logsDir = join(workspace, ".pi", "logs");

	let files;
	try {
		files = await readdir(logsDir);
	} catch {
		process.stderr.write(`[logs] No logs found yet in ${logsDir}\n`);
		process.exit(1);
	}
	const candidates = ["latest.log", "summary.md", "loop.out"];
	let chosen = candidates.find((c) => files.includes(c)) || null;
	if (!chosen && files.length) chosen = files[0];
	if (!chosen) {
		process.stderr.write(`[logs] No logs found yet in ${logsDir}\n`);
		process.exit(1);
	}

	const raw = await readFile(join(logsDir, chosen), "utf8");
	const lines = raw.split("\n");
	process.stdout.write(`[logs] ${chosen} (last ${Math.min(tail, lines.length)} of ${lines.length} lines)\n`);
	process.stdout.write(lines.slice(-tail).join("\n") + "\n");
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi logs] error: ${err?.stack || err}\n`);
	process.exit(2);
});
