#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-sync-config` command (M13, plan.md §3.3).
 *
 * Recopies the harness config defaults into `{project}/.pi/config.json` while
 * preserving project-specific values (name, repo, owner, ownerEmail, demoUrl,
 * defaultBranch, custom overrides, telegram overrides).
 *
 *   npm run sync-config
 *
 * Flags:
 *   --help   show usage
 */

import { readActiveProject } from "../extensions/loop/orchestrator.js";
import { syncConfig } from "../skills/config/core.js";

function usage() {
	return [
		"auto-pi sync-config — recopy harness config defaults into .pi/config.json",
		"",
		"Usage:",
		"  node scripts/sync-config.js",
		"",
		"Preserves project-specific values (name, repo, owner, email, demo URL,",
		"branch, custom overrides, telegram overrides) while applying defaults.",
		"",
		"Flags:",
		"  --help   show this usage",
	].join("\n");
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(usage() + "\n");
		process.exit(0);
	}

	const activeRes = await readActiveProject();
	if (!activeRes.ok) {
		process.stderr.write(`[sync-config] ${activeRes.error}\n`);
		process.exit(1);
	}
	const workspace = activeRes.active.workspace;
	const res = await syncConfig(workspace);
	if (!res.ok) {
		process.stderr.write(`[sync-config] ${res.error || "Config sync failed."}\n`);
		process.exit(1);
	}
	const changed = res.changed?.length ? ` (updated: ${res.changed.join(", ")})` : " (no changes)";
	process.stdout.write(`[sync-config] Config synced to defaults${changed}.\n`);
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi sync-config] error: ${err?.stack || err}\n`);
	process.exit(2);
});
