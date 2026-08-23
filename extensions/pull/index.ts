/**
 * The auto-pi `/loop-pull` command.
 *
 * Pulls an existing auto-pi project from a GitHub repo onto this machine so it
 * can be continued here exactly as if it had been seeded locally. This is the
 * "continue on a different machine" companion to `/loop-seed`:
 *
 *   pi install /path/to/auto-pi
 *   /loop-pull https://github.com/AntonLapshin/ape-kingdom
 *
 * It clones the repo into the same `~/.auto-pi/workspaces/{owner}/{repo}/repo`
 * layout `/loop-seed` uses, verifies it is an auto-pi project (committed
 * `.pi/config.json`), recreates the git-ignored `.pi/state/initiation.json`
 * marker (so `/loop-switch` and the loop-recognition helpers see it as a
 * locally-seeded project), records it as the active project, and starts the
 * loop.
 *
 * After `/loop-pull`, every other auto-pi command works exactly as if the
 * project had been seeded on this machine: `/loop-switch`, `/loop-status`,
 * `/loop-logs`, `/loop-restart`, `/loop`, etc.
 *
 * Uses the shared core in `extensions/pull/core.js` (also used by the
 * `npm run pull` fallback CLI) with the live Pi UI dialogs injected as the
 * `io` handlers.
 *
 * Usage: `/loop-pull <github-repo-url-or-owner/repo>`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPull } from "./core.js";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("loop-pull", {
		description:
			"Pull an existing auto-pi project from a GitHub repo onto this machine so it can be continued as if it were seeded locally (clone, configure, record as active, start the loop)",
		handler: async (args, ctx) => {
			const ref = String(args ?? "").trim();

			if (!ref) {
				ctx.ui.notify(
					"Usage: /loop-pull <github-repo-url-or-owner/repo>\n" +
						"e.g. /loop-pull https://github.com/AntonLapshin/ape-kingdom",
					"warning",
				);
				return;
			}

			const io = {
				notify: (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
					ctx.ui.notify(text, level),

				confirmPull: async (repo: string): Promise<boolean> => {
					return ctx.hasUI && ctx.ui.confirm
						? Boolean(
								await ctx.ui.confirm(
									`Pull ${repo} onto this machine?`,
									`Auto-pi will clone ${repo} into the local workspace, record it as the active project, and start the autonomous loop.\n\nProceed?`,
								),
							)
						: true;
				},
			};

			const result = await runPull(ref, io);
			if (result.ok) {
				ctx.ui.notify(result.message, "success");
			} else {
				ctx.ui.notify(result.message, "error");
			}
			// Surface in stdout too for print/rpc modes where notify is a no-op.
			process.stdout.write(result.message + "\n");
		},
	});
}
