/**
 * The auto-pi `/doctor` command (M1).
 *
 * Validates all environment prerequisites before any project work begins, using the
 * shared core in `extensions/doctor/core.js`. The `/doctor` command supersedes the
 * `npm run doctor` fallback CLI, adding the live Pi provider/model (from ctx) to the
 * standalone detection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runChecks, allPassed, formatReport } from "./core.js";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("doctor", {
		description: "Validate all environment prerequisites before starting work",
		handler: async (_args, ctx) => {
			const overrides: { provider?: string; model?: string } = {};
			if (ctx.model) {
				overrides.provider = ctx.model.provider;
				overrides.model = ctx.model.id;
			}

			const results = await runChecks({ overrides });
			const report = formatReport(results);

			if (allPassed(results)) {
				ctx.ui.notify(report, "success");
			} else {
				ctx.ui.notify(report, "error");
			}

			// Also write to stdout so the report is visible/verifiable in
			// print (-p) and RPC modes, where notify may not surface.
			process.stdout.write(report + "\n");
		},
	});
}
