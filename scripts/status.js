#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/loop-status` command (M13).
 *
 * Reports the active project, loop status, last persona run, open issues/PRs,
 * and budget usage. Reuses the shared `skills/status/core.js` so the CLI and
 * the interactive `/loop-status` command report identical results.
 *
 *   npm run status
 */

import { buildStatus } from "../skills/status/core.js";

async function main() {
	const res = await buildStatus();
	if (!res.ok) {
		process.stderr.write(`[status] ${res.error || "No active project."}\n`);
		process.exit(1);
	}
	process.stdout.write((res.report || "") + "\n");
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[auto-pi status] error: ${err?.stack || err}\n`);
	process.exit(2);
});
