#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi Telegram notifications (M11, plan.md §24).
 *
 * Sends a Telegram lifecycle notification for the active project using the
 * shared `skills/telegram-notify/core.js` logic. Reuses the same config + env
 * resolution as the loop orchestrator so the CLI behaves identically.
 *
 * Flags:
 *   --event <event>   done | needs-human | stopped-budget | stopped-manual
 *   --reason <text>   extra detail for the message
 *   --help            show usage
 *
 * No-ops (exit 0) without error when notifications are disabled or the required
 * env vars are absent — matching the loop's non-fatal behavior.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { notifyEvent } from "../skills/telegram-notify/core.js";
import { readActiveProject } from "../extensions/loop/orchestrator.js";

const EVENTS = new Set(["done", "needs-human", "stopped-budget", "stopped-manual"]);

function usage() {
	return [
		"auto-pi notify — send a Telegram lifecycle notification for the active project",
		"",
		"Usage:",
		"  node scripts/notify.js --event <event> [--reason <text>] [--workspace <path>]",
		"",
		"Events:",
		"  done             project completed",
		"  needs-human      project needs human attention",
		"  stopped-budget   loop stopped due to budget",
		"  stopped-manual   loop stopped manually",
		"",
		"Flags:",
		"  --workspace <path>  explicit project workspace (defaults to the active project)",
		"  --help              show this usage",
	].join("\n");
}

async function readConfig(workspace) {
	try {
		const raw = await readFile(join(workspace, ".pi", "config.json"), "utf8");
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

async function readCompleted(workspace) {
	try {
		const raw = await readFile(join(workspace, ".pi", "state", "completed.json"), "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}
	const valueOf = (name) => {
		const eq = argv.find((a) => a.startsWith(`${name}=`));
		if (eq) return eq.slice(name.length + 1);
		const idx = argv.indexOf(name);
		if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) return argv[idx + 1];
		return null;
	};
	// Accept both `--event done` and `--event=done` forms.
	const event = valueOf("--event");
	const reason = valueOf("--reason") || "";
	let workspace = valueOf("--workspace") || null;

	if (!event || !EVENTS.has(event)) {
		process.stderr.write(`[notify] invalid/missing --event (expected one of: ${[...EVENTS].join(", ")})\n`);
		process.exit(2);
	}

	if (!workspace) {
		const active = await readActiveProject();
		if (!active.ok) {
			process.stderr.write(`[notify] ${active.error}\n`);
			process.exit(1);
		}
		workspace = active.active.workspace;
	}

	const config = await readConfig(workspace);
	const completed = event === "done" ? await readCompleted(workspace) : null;
	const result = await notifyEvent({ workspace, config, event, reason, completed });

	// Disabled / missing env → no-op, exit 0 (non-fatal by design).
	if (!result.ok && result.reason) {
		process.stdout.write(`[notify] skipped: ${result.reason}\n`);
	}
	process.exit(result.ok ? 0 : 0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi notify] error: ${err?.stack || err}\n`);
	process.exit(2);
});
