/**
 * Shared log-tail and stop-file helpers (Phase A3).
 *
 * Single source of truth for the "show the latest local logs" behavior used
 * by both the interactive `/loop-logs` command (`extensions/harness.ts`) and
 * the `npm run logs` fallback CLI (`scripts/logs.js`), and for the stop-file
 * removal shared by `/loop-resume` and `npm run resume`.
 *
 * Plain JS on purpose — imported by `scripts/*.js` (plain node) and by
 * `extensions/harness.ts` (via jiti), matching the seed/loop convention.
 */

import { join } from "node:path";
import { readFile, readdir, rm } from "node:fs/promises";

/** Default number of log lines shown by `/loop-logs` / `npm run logs`. */
export const DEFAULT_TAIL_LINES = 40;

/** Log-file preference order: tail-friendly first. */
export const LOG_CANDIDATES = ["latest.log", "summary.md", "loop.out"];

/**
 * Parse a `--tail N` argument (default {@link DEFAULT_TAIL_LINES}).
 * Accepts `--tail N`, `--tail=N`, and raw `args` strings from slash commands.
 *
 * @param {string|string[]} args raw args string or argv slice
 * @param {number} [fallback] default when no valid `--tail` is present
 * @returns {number}
 */
export function parseTailArg(args, fallback = DEFAULT_TAIL_LINES) {
	const text = Array.isArray(args) ? args.join(" ") : String(args || "");
	const m = /--tail[= ](\d+)/i.exec(text);
	if (m) {
		const n = parseInt(m[1], 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return fallback;
}

/**
 * Read the preferred log file for a workspace and return its last `tail` lines.
 *
 * @param {string} workspace project workspace path
 * @param {number} [tail] number of lines (default {@link DEFAULT_TAIL_LINES})
 * @returns {Promise<{ ok: boolean, file?: string, text?: string, totalLines?: number, error?: string }>}
 */
export async function readTailLog(workspace, tail = DEFAULT_TAIL_LINES) {
	const logsDir = join(workspace, ".pi", "logs");
	return readTailLogDir(logsDir, tail);
}

/**
 * Tail the preferred log file inside an explicit logs directory.
 *
 * @param {string} logsDir absolute `.pi/logs` directory
 * @param {number} [tail]
 */
export async function readTailLogDir(logsDir, tail = DEFAULT_TAIL_LINES) {
	let files;
	try {
		files = await readdir(logsDir);
	} catch (err) {
		return { ok: false, error: `No logs found yet in ${logsDir}` };
	}
	let chosen = LOG_CANDIDATES.find((c) => files.includes(c)) || null;
	if (!chosen && files.length) chosen = files[0];
	if (!chosen) {
		return { ok: false, error: `No logs found yet in ${logsDir}` };
	}
	try {
		const raw = await readFile(join(logsDir, chosen), "utf8");
		const lines = raw.split("\n");
		const text = lines.slice(-tail).join("\n");
		return { ok: true, file: chosen, text, totalLines: lines.length };
	} catch (err) {
		return { ok: false, error: `Could not read logs: ${err?.message || err}` };
	}
}

/**
 * Remove the loop stop marker (best-effort, never throws).
 *
 * @param {string} workspace project workspace path
 * @returns {Promise<void>}
 */
export async function removeStopFile(workspace) {
	const stopFile = join(workspace, ".pi", "state", "stop");
	try {
		await rm(stopFile, { force: true });
	} catch {
		// best-effort: the loop treats a missing stop file as "not stopped"
	}
}
