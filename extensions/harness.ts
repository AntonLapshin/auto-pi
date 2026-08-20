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
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { buildStatus } from "../skills/status/core.js";
import { syncConfig } from "../skills/config/core.js";
import { readActiveProject } from "./loop/orchestrator.js";

/** Parse a `--tail N` argument (default 40 lines). */
function parseTailArg(args: string): number {
	const m = /--tail[= ](\d+)/i.exec(String(args || ""));
	if (m) {
		const n = parseInt(m[1], 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return 40;
}

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
			const logsDir = join(workspace, ".pi", "logs");
			const tail = parseTailArg(args);

			let text = "";
			try {
				const files = await readdir(logsDir);
				// Prefer latest.log (tail-friendly), then summary.md, then loop.out.
				const candidates = ["latest.log", "summary.md", "loop.out"];
				let chosen: string | null = null;
				for (const c of candidates) {
					if (files.includes(c)) {
						chosen = c;
						break;
					}
				}
				if (!chosen && files.length) chosen = files[0];
				if (!chosen) {
					ctx.ui.notify("No logs found yet in .pi/logs.", "info");
					return;
				}
				const raw = await readFile(join(logsDir, chosen), "utf8");
				const lines = raw.split("\n");
				text = lines.slice(-tail).join("\n");
			} catch (err) {
				ctx.ui.notify(`Could not read logs: ${err?.message || err}`, "error");
				return;
			}
			ctx.ui.notify(text || "(empty log)", "info");
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
				ctx.ui.notify(activeRes.error, "error");
				return;
			}
			const workspace = activeRes.active.workspace;

			// Remove the stop file so the loop no longer exits immediately.
			const stopFile = join(workspace, ".pi", "state", "stop");
			try {
				const { rm } = await import("node:fs/promises");
				await rm(stopFile, { force: true });
			} catch {
				// best-effort
			}

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
			} catch {
				// fall through and start the loop
			}

			// Start the loop detached (nohup) so the interactive session is not blocked.
			try {
				const { execa } = await import("execa");
				const script = new URL("../scripts/loop.js", import.meta.url).pathname;
				await execa("nohup", ["node", script], {
					cwd: workspace,
					detached: true,
					stdio: "ignore",
				}).catch(() => {});
				ctx.ui.notify(
					`Resumed ${activeRes.active.repo || workspace}: stop marker removed, loop started. Check .pi/logs/loop.out.`,
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
