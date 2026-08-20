#!/usr/bin/env node
/**
 * Fallback CLI entry for the auto-pi `/doctor` command (M1).
 *
 * Shared logic lives in extensions/doctor/core.js so the CLI and the interactive
 * `/doctor` command report identical results. Exits non-zero if any required check
 * fails (useful for CI / shell gates before starting work).
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runChecks, allPassed, formatReport } from "../extensions/doctor/core.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
	try {
		const results = await runChecks();
		process.stdout.write(formatReport(results) + "\n");
		process.exit(allPassed(results) ? 0 : 1);
	} catch (err) {
		process.stderr.write(`[auto-pi doctor] error: ${err?.stack || err}\n`);
		process.exit(2);
	}
}

main();
