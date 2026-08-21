/**
 * The auto-pi `/loop`, `/loop-stop`, and `/loop-restart` commands (M6).
 *
 * `/loop` starts the autonomous loop for the active project (or reports that a
 * loop is already running). `/loop-stop` stops it by writing the stop file.
 * `/loop-restart` safely restarts it: stop the running loop (waiting for it to
 * exit cleanly), then start it again.
 *
 * All reuse the shared core in `extensions/loop/orchestrator.js` (also used by
 * the `npm run loop` / `npm run stop` / `npm run restart` fallback CLIs) so the
 * interactive commands and the CLI behave identically.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
	runLoopCycle,
	readActiveProject,
	checkLock,
	writeStopFile,
	clearActiveProject,
	restartLoop,
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
				// `setsid` puts the loop in its own session/process group with no
				// controlling terminal so spawned persona `pi` sessions never inherit the
				// interactive tty (which otherwise hangs them in batch mode). stdin is
				// redirected from /dev/null so the loop never reads the shared tty.
				const script = new URL("../../scripts/loop.js", import.meta.url).pathname;
				// Propagate the resolved provider/model into the detached loop process
				// (nohup does not inherit the interactive session's PI_* env vars).
				const { providerEnv } = await import("./provider-env.js");
				const logFile = join(workspace, ".pi", "logs", "loop.out");
				await execa("bash", ["-c", `setsid nohup node "${script}" </dev/null > "${logFile}" 2>&1 & echo $!`], {
					cwd: workspace,
					env: providerEnv(),
					reject: false,
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

	pi.registerCommand("loop-restart", {
		description:
			"Safely restart the autonomous loop for the active project: stop the running loop (let it finish its current cycle), then start it again",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
				ctx.ui.notify(text, level);

			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				notify(`${activeRes.error} Use /loop-seed to start a new project.`, "error");
				return;
			}
			const workspace = activeRes.active.workspace;

			// Optional: how long to wait for the running loop to exit cleanly
			// before aborting (default 60s, or a persona may still be finishing).
			const arg = String(args ?? "").trim();
			const timeoutMatch = /--timeout[= ](\d+)/i.exec(arg);
			const timeoutMs = timeoutMatch ? Number(timeoutMatch[1]) * 1000 : undefined;

			const result = await restartLoop(workspace, {
				timeoutMs,
				log: (line: string) => process.stdout.write(`[loop-restart] ${line}\n`),
			});

			if (result.ok) {
				notify(result.message, "success");
			} else if (result.timedOut) {
				notify(result.message, "warning");
			} else {
				notify(result.message, "error");
			}
			process.stdout.write(result.message + "\n");
		},
	});
}
