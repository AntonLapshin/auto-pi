/**
 * The auto-pi `/loop` and `/loop-stop` commands (M6).
 *
 * `/loop` starts the autonomous loop for the active project (or reports that a
 * loop is already running). `/loop-stop` stops it by writing the stop file.
 *
 * Both reuse the shared core in `extensions/loop/orchestrator.js` (also used by
 * the `npm run loop` / `npm run stop` fallback CLIs) so the interactive commands
 * and the CLI behave identically.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	runLoopCycle,
	readActiveProject,
	checkLock,
	writeStopFile,
	clearActiveProject,
} from "./orchestrator.js";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("loop", {
		description:
			"Start (or report) the autonomous loop for the active project: scan GitHub, dispatch a persona, run a fresh session, repeat",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;

			// Refuse to start a second loop for the same project (plan.md §13.2).
			const lock = await checkLock(workspace);
			if (lock.locked) {
				notify(
					`A loop is already running for this project (PID ${lock.pid}). Use /loop-stop to stop it.`,
					"warning",
				);
				return;
			}

			const arg = String(args ?? "").trim();
			if (arg === "--once" || arg === "once") {
				const result = await runLoopCycle(workspace, {
					log: (line) => process.stdout.write(`[loop] ${line}\n`),
				});
				notify(result.message, result.ok ? "success" : "error");
				return;
			}

			// Start the loop detached (nohup) so the interactive session is not
			// blocked, matching the `/loop-seed` launch pattern.
			const { execa } = await import("execa");
			try {
				// Launch the fallback CLI under nohup, capturing output to the loop log.
				const script = new URL("../../scripts/loop.js", import.meta.url).pathname;
				// Propagate the resolved provider/model into the detached loop process
				// (nohup does not inherit the interactive session's PI_* env vars).
				const { providerEnv } = await import("./provider-env.js");
				await execa("nohup", ["node", script], {
					cwd: workspace,
					detached: true,
					stdio: "ignore",
					env: providerEnv(),
				}).catch(() => {});
				notify(
					`Loop started for ${activeRes.active.repo || workspace} (detached). Check .pi/logs/loop.out.`,
					"success",
				);
			} catch (err) {
				notify(`Could not start the loop: ${err?.message || err}`, "error");
			}
		},
	});

	pi.registerCommand("loop-stop", {
		description: "Stop the autonomous loop for the active project (writes the stop file)",
		handler: async (_args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;
			const stopFile = await writeStopFile(workspace);
			notify(`Stop file written: ${stopFile}. The loop will exit at its next cycle.`);
			// Stopping "finishes" the project: release the one-project-per-machine
			// slot so `/loop-seed` can start a new project (previously the
			// active-project record lingered and `/loop-seed` kept refusing).
			const cleared = await clearActiveProject();
			if (cleared.ok) {
				notify("Active-project record cleared — you can now run /loop-seed again.", "success");
			} else {
				notify(cleared.message, "warning");
			}
		},
	});
}
