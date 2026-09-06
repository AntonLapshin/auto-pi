/**
 * auto-pi harness commands.
 *
 * Registers the `/loop-status`, `/loop-logs`, `/loop-resume`, and `/loop-sync-config` slash commands
 * (M13). The other commands are implemented by their own extensions: `/loop-doctor`
 * in `extensions/doctor` (M1), `/loop-seed` in `extensions/seed` (M2), and `/loop` +
 * `/loop-stop` in `extensions/loop` (M6).
 *
 * Commands are registered programmatically via `pi.registerCommand()`, which is
 * the canonical Pi extension schema for commands (the `pi` block in package.json
 * only declares directories for extensions/skills/prompts/themes).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildStatus } from "../skills/status/core.js";
import { syncConfig } from "../skills/config/core.js";
import { readActiveProject } from "./loop/orchestrator.js";
import { parseTailArg, readTailLog, removeStopFile } from "./loop/log-helpers.js";
import { warnSuppressed } from "./loop/result.js";

export default function (pi: ExtensionAPI) {
	// --- /loop-status (M13) ---
	pi.registerCommand("loop-status", {
		description:
			"Show active project, loop status, last persona run, open issues/PRs, and budget usage",
		handler: async (_args, ctx) => {
			const res = await buildStatus();
			if (!res.ok) {
				ctx.ui.notify(res.error || "No active project.", "error");
				process.stdout.write((res.error || "No active project.") + "\n");
				return;
			}
			ctx.ui.notify(res.report || "", "info");
			process.stdout.write((res.report || "") + "\n");
		},
	});

	// --- /loop-logs (M13) ---
	pi.registerCommand("loop-logs", {
		description: "Show the latest local loop / run logs for the active project",
		handler: async (args, ctx) => {
			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				ctx.ui.notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;
			const tail = parseTailArg(args);

			// Shared with `npm run logs` (scripts/logs.js) via log-helpers.js.
			// Note: unlike the CLI (exit 1), "no logs yet" is an info
			// notification here, not a failure.
			const res = await readTailLog(workspace, tail);
			if (!res.ok) {
				ctx.ui.notify(res.error || "No logs found yet in .pi/logs.", "info");
				return;
			}
			const text = res.text || "(empty log)";
			ctx.ui.notify(text, "info");
			process.stdout.write(text + "\n");
		},
	});

	// --- /loop-resume (M13) ---
	// Named `/loop-resume` (not `/resume`) to avoid conflicting with pi's built-in
	// `/resume` interactive command (switch session).
	pi.registerCommand("loop-resume", {
		description:
			"Resume a stopped/paused project's loop (removes the stop marker and starts the loop if not running)",
		handler: async (args, ctx) => {
			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				ctx.ui.notify(
					`${activeRes.error} Use /loop-seed to start a new project.`,
					"error",
				);
				return;
			}
			const workspace = activeRes.active.workspace;

			// Remove the stop file so the loop no longer exits immediately.
			// Shared with `npm run resume` (scripts/resume.js) via log-helpers.js.
			await removeStopFile(workspace);

			// Check whether a loop is already running.
			try {
				const { checkLock } = await import("./loop/orchestrator.js");
				const lock = await checkLock(workspace);
				if (lock.locked) {
					ctx.ui.notify(
						`Resumed: stop marker removed. A loop is already running (PID ${lock.pid}); it will continue.`,
						"success",
					);
					return;
				}
			} catch (err) {
				warnSuppressed("loop-resume.check-lock", err);
				// fall through and start the loop
			}

		// Start the loop detached (shared `startLoopDetached` — same
		// setsid/nohup launch with provider/model propagation as /loop-seed,
		// /loop-pull and `npm run resume`) so the session is not blocked.
		try {
			const { startLoopDetached } = await import("./loop/orchestrator.js");
			const started = await startLoopDetached(workspace);
			if (!started.ok) {
				ctx.ui.notify(`Stop marker removed but could not start the loop: ${started.message}`, "warning");
				return;
			}
			ctx.ui.notify(
				`Resumed ${activeRes.active.repo || workspace}: stop marker removed, loop started${started.pid ? ` (PID ${started.pid})` : ""}. Check .pi/logs/loop.out.`,
				"success",
			);
		} catch (err) {
			ctx.ui.notify(`Stop marker removed but could not start the loop: ${err?.message || err}`, "warning");
		}
		},
	});

	// --- /loop-sync-config (M13) ---
	pi.registerCommand("loop-sync-config", {
		description:
			"Recopy harness config defaults into .pi/config.json while preserving project-specific values",
		handler: async (_args, ctx) => {
			const activeRes = await readActiveProject();
			if (!activeRes.ok) {
				ctx.ui.notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;
			const res = await syncConfig(workspace);
			if (!res.ok) {
				ctx.ui.notify(res.error || "Config sync failed.", "error");
				return;
			}
			const changed = res.changed?.length ? ` (updated: ${res.changed.join(", ")})` : " (no changes)";
			ctx.ui.notify(`Config synced to defaults${changed}.`, "success");
			process.stdout.write(`Config synced to defaults${changed}.\n`);
		},
	});
}
