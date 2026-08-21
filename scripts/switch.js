#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-switch` command.
 *
 * Switches the active project to another locally-seeded project: safely stops
 * the current project's loop (if any), points the per-machine active-project
 * record at the target, and starts the target's loop.
 *
 *   npm run switch <repo-or-project-name>   # switch to a specific project
 *   npm run switch                          # list projects and switch to the first
 *   npm run switch -- --no-start             # switch without auto-starting the loop
 *   npm run switch -- --list                 # just list available projects
 *
 * Flags:
 *   --no-start   switch the active-project record but do not start the loop
 *   --list       list available local projects and exit
 *   --timeout N  seconds to wait for the current loop to exit (default 60)
 *   --help       show usage
 */

import { join } from "node:path";
import { listProjects, switchProject } from "../extensions/loop/orchestrator.js";

function usage() {
	return [
		"auto-pi switch — switch the active project to another locally-seeded project",
		"",
		"Usage:",
		"  node scripts/switch.js [repo-or-project-name] [--no-start] [--list] [--timeout N]",
		"",
		"Flags:",
		"  --no-start   switch the active-project record but do not start the loop",
		"  --list       list available local projects and exit",
		"  --timeout N  seconds to wait for the current loop to exit (default 60)",
		"  --help       show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const noStart = argv.includes("--no-start");
	const listOnly = argv.includes("--list");
	const timeoutMatch = argv.find((a) => a.startsWith("--timeout=")) || null;
	const timeoutSec = timeoutMatch ? parseInt(timeoutMatch.split("=")[1], 10) : undefined;
	const target = argv.filter((a) => !a.startsWith("--")).join(" ").trim();

	if (listOnly) {
		const projects = await listProjects();
		if (projects.length === 0) {
			process.stdout.write("[switch] No local projects found. Use /loop-seed (npm run seed) to create one.\n");
			process.exit(0);
		}
		process.stdout.write("[switch] Available projects:\n");
		for (const p of projects) {
			process.stdout.write(`  ${p.repo}  —  ${p.projectName}  (${p.workspace})\n`);
		}
		process.exit(0);
	}

	if (!target) {
		const projects = await listProjects();
		if (projects.length === 0) {
			process.stderr.write("[switch] No local projects found. Use /loop-seed (npm run seed) to create one.\n");
			process.exit(1);
		}
		process.stdout.write("[switch] No target given; available projects:\n");
		for (const p of projects) {
			process.stdout.write(`  ${p.repo}  —  ${p.projectName}\n`);
		}
		process.stderr.write("[switch] Pass a repo or project name, e.g. `npm run switch -- build-a-notes-app`.\n");
		process.exit(1);
	}

	const io = { log: (line) => process.stdout.write(`[switch] ${line}\n`) };
	const result = await switchProject(target, io, {
		startLoop: !noStart,
		timeoutMs: timeoutSec ? timeoutSec * 1000 : undefined,
	});
	process.stdout.write(result.message + "\n");
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi switch] error: ${err?.stack || err}\n`);
	process.exit(2);
});
