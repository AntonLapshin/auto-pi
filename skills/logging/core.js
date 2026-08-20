/**
 * Logging core for the auto-pi harness (M10, plan.md §20, §28 "Milestone 10").
 *
 * Implements local, git-ignored run/error/summary logging and token-usage
 * accounting for the autonomous loop. All logs live under the active project's
 * workspace in `{workspace}/.pi/logs/`:
 *
 *   runs.jsonl     one JSON line per persona run (plan.md §20.1 schema)
 *   errors.jsonl   one JSON line per logged error / failed run
 *   summary.md     human-readable execution summary (plan.md §20.2)
 *   summary.jsonl  machine-readable summary records (one per summary write)
 *   latest.log     latest plain-text activity log (tail-friendly)
 *   usage.jsonl    per-day / per-cycle token accumulation (feeds M13 budget
 *                  guard and `/status`)
 *
 * Plain JS on purpose — imported via jiti by the `/loop` extension and directly
 * by tests / node scripts, matching the doctor/seed/loop conventions.
 *
 * Secret redaction (plan.md §20, §7.2): logs must never contain tokens or
 * secrets. `redactSecrets()` scrubs API keys, bearer tokens, GitHub tokens,
 * and other secret-shaped values from any text before it is written.
 */

import { join } from "node:path";
import {
	readFile,
	writeFile,
	appendFile,
	mkdir,
	stat,
	rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";

/** Relative (to workspace) root of the harness logs directory. */
export const LOGS_DIR_REL = ".pi/logs";

/** Relative (to workspace) path of the runs ledger (JSONL). */
export const RUNS_LOG_REL = join(LOGS_DIR_REL, "runs.jsonl");

/** Relative (to workspace) path of the error ledger (JSONL). */
export const ERRORS_LOG_REL = join(LOGS_DIR_REL, "errors.jsonl");

/** Relative (to workspace) path of the markdown execution summary. */
export const SUMMARY_MD_REL = join(LOGS_DIR_REL, "summary.md");

/** Relative (to workspace) path of the machine-readable summary ledger. */
export const SUMMARY_JSONL_REL = join(LOGS_DIR_REL, "summary.jsonl");

/** Relative (to workspace) path of the latest plain-text activity log. */
export const LATEST_LOG_REL = join(LOGS_DIR_REL, "latest.log");

/** Relative (to workspace) path of the token-usage accumulation ledger. */
export const USAGE_LOG_REL = join(LOGS_DIR_REL, "usage.jsonl");

/** Version of the run-log record schema (plan.md §20.1). */
export const RUN_LOG_VERSION = 1;

/** Version of the summary record schema. */
export const SUMMARY_VERSION = 1;

/** Default max run-log file size in MB before rotation (config override). */
export const DEFAULT_MAX_FILE_SIZE_MB = 10;

/** Default whether to rotate logs when they exceed the max size. */
export const DEFAULT_ROTATE = true;

/** Resolve the absolute paths of the log files for a workspace. */
export function logPaths(workspace) {
	return {
		dir: join(workspace, LOGS_DIR_REL),
		runs: join(workspace, RUNS_LOG_REL),
		errors: join(workspace, ERRORS_LOG_REL),
		summaryMd: join(workspace, SUMMARY_MD_REL),
		summaryJsonl: join(workspace, SUMMARY_JSONL_REL),
		latest: join(workspace, LATEST_LOG_REL),
		usage: join(workspace, USAGE_LOG_REL),
	};
}

/**
 * Secret-shaped value patterns. Used by `redactSecrets` to scrub anything that
 * looks like a token/API key/secret before it reaches a log file.
 */
const SECRET_PATTERNS = [
	// GitHub / generic PAT: ghp_, gho_, github_pat_, ghs_, glpat_, xoxb-, sk-…
	/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{20,})\b/g,
	// Long high-entropy tokens (>= 24 chars) that are not obviously safe.
	// Excludes pure 40-char lowercase-hex strings (git SHAs are public, not
	// secrets) and ISO timestamps.
	/(?<![A-Za-z0-9_-])(?!\b[0-9a-f]{40}\b)(?:[A-Za-z0-9_-]*[A-Z][A-Za-z0-9_-]*|[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*){1}[A-Za-z0-9_-]{18,}\b/g,
	// Authorization / Bearer / token / api_key / password = <value> assignments.
	/(?<![A-Za-z0-9_-])(authorization|bearer|access[-_]?token|api[-_]?key|token|secret|password|passwd|client[-_]?secret)\s*[:=]\s*["']?([^"'\s,;]+)/gi,
];

/**
 * Redact secrets from a string so logs never leak tokens/API keys.
 *
 * Replaces secret-shaped values with `[REDACTED]`. Safe to call on any text
 * (run records, error messages, summaries, stdout) before writing it to a log.
 *
 * @param {string} text
 * @returns {string} the redacted text
 */
export function redactSecrets(text) {
	if (typeof text !== "string" || text.length === 0) return text;
	let out = text;
	for (const re of SECRET_PATTERNS) {
		out = out.replace(re, (match, ...groups) => {
			// For the assignment pattern, keep the key name but redact the value.
			const key = groups[0];
			if (key && /^(authorization|bearer|access[-_]?token|api[-_]?key|token|secret|password|passwd|client[-_]?secret)$/i.test(key)) {
				const rest = match.slice(match.indexOf(key) + key.length);
				return `${key}${rest.replace(/[^"'\s,;=:]+/g, "[REDACTED]")}`;
			}
			return "[REDACTED]";
		});
	}
	return out;
}

/**
 * Ensure the log directory exists.
 * @param {string} workspace
 */
export async function ensureLogDir(workspace) {
	await mkdir(logPaths(workspace).dir, { recursive: true });
}

/**
 * Read the configured logging options from a parsed config.
 * @param {object} [config] parsed .pi/config.json
 * @returns {{ maxFileSizeMb: number, rotate: boolean }}
 */
export function loggingOptions(config = {}) {
	const l = config?.logging || {};
	const maxFileSizeMb = Number(l.maxFileSizeMb);
	return {
		maxFileSizeMb:
			Number.isFinite(maxFileSizeMb) && maxFileSizeMb > 0
				? maxFileSizeMb
				: DEFAULT_MAX_FILE_SIZE_MB,
		rotate: l.rotate !== undefined ? Boolean(l.rotate) : DEFAULT_ROTATE,
	};
}

/**
 * Roll a single log file if it exceeds the configured max size: rename it to
 * `{name}.1` (dropping any older `.1`). No-op when rotation is disabled.
 *
 * @param {string} workspace
 * @param {string} relPath  relative path of the file to check (e.g. RUNS_LOG_REL)
 * @param {object} [config] parsed config for `logging.*`
 * @returns {Promise<boolean>} true if the file was rolled
 */
export async function rollLog(workspace, relPath, config = {}) {
	const { maxFileSizeMb, rotate } = loggingOptions(config);
	if (!rotate) return false;
	const abs = join(workspace, relPath);
	try {
		const st = await stat(abs);
		const maxBytes = maxFileSizeMb * 1024 * 1024;
		if (st.size > maxBytes) {
			const rolled = `${abs}.1`;
			await rename(rolled, `${rolled}.old`).catch(() => {});
			await rename(abs, rolled).catch(() => {});
			return true;
		}
	} catch {
		// file doesn't exist yet — nothing to roll
	}
	return false;
}

/**
 * Append a JSONL record to a log file, applying rotation first. The record is
 * redacted before being written so secrets never reach the log.
 *
 * @param {string} workspace
 * @param {string} relPath  relative path of the JSONL file
 * @param {object} record   plain object to append as one JSON line
 * @param {object} [config] parsed config for `logging.*`
 */
export async function appendJsonl(workspace, relPath, record, config = {}) {
	await ensureLogDir(workspace);
	await rollLog(workspace, relPath, config);
	const json = JSON.stringify(record);
	const safe = redactSecrets(json);
	await appendFile(join(workspace, relPath), safe + "\n", "utf8");
}

/**
 * Append a run record to `runs.jsonl` (plan.md §20.1 schema).
 *
 * @param {string} workspace
 * @param {object} record  run record (see buildRunRecord for the schema)
 * @param {object} [config]
 * @returns {Promise<string>} the appended JSON line
 */
export async function appendRunRecord(workspace, record, config = {}) {
	const full = { version: RUN_LOG_VERSION, ...record };
	await appendJsonl(workspace, RUNS_LOG_REL, full, config);
	return JSON.stringify(full);
}

/**
 * Append an error record to `errors.jsonl`.
 *
 * @param {string} workspace
 * @param {object} record  { runId?, persona?, error, at, context? }
 * @param {object} [config]
 */
export async function appendErrorRecord(workspace, record, config = {}) {
	const full = {
		version: RUN_LOG_VERSION,
		at: new Date().toISOString(),
		...record,
	};
	await appendJsonl(workspace, ERRORS_LOG_REL, full, config);
}

/**
 * Write the latest plain-text activity log (tail-friendly). Redacts secrets.
 *
 * @param {string} workspace
 * @param {string} text
 */
export async function writeLatestLog(workspace, text) {
	await ensureLogDir(workspace);
	await writeFile(logPaths(workspace).latest, redactSecrets(text) + "\n", "utf8");
}

/**
 * Build a run record following the plan.md §20.1 schema.
 *
 * Fields: runId, startedAt, finishedAt, persona, trigger, projectName, repo,
 * issueNumber, prNumber, status, action, reason, error, tokensInput,
 * tokensOutput, tokensTotal, durationSeconds, gitSha.
 *
 * @param {object} p
 * @param {string} [p.runId]
 * @param {string} [p.persona]
 * @param {string} [p.trigger]        e.g. "dispatch:engineer" / "manual" / "loop"
 * @param {string} [p.projectName]
 * @param {string} [p.repo]           owner/repo
 * @param {number} [p.issueNumber]
 * @param {number} [p.prNumber]
 * @param {string} [p.status]         "ok" | "error" | "waiting" | "stopped"
 * @param {string} [p.action]         "ran" | "waiting" | "stopped" | "error" | "noop"
 * @param {string} [p.reason]
 * @param {string} [p.error]
 * @param {number} [p.tokensInput]
 * @param {number} [p.tokensOutput]
 * @param {number} [p.tokensTotal]
 * @param {number} [p.durationSeconds]
 * @param {string} [p.gitSha]
 * @returns {object} run record
 */
export function buildRunRecord(p = {}) {
	const tokensInput = Number(p.tokensInput) || 0;
	const tokensOutput = Number(p.tokensOutput) || 0;
	let durationSeconds = Number(p.durationSeconds);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		// Derive from timestamps when not explicitly provided.
		const start = Date.parse(p.startedAt || "");
		const finish = Date.parse(p.finishedAt || "");
		durationSeconds =
			Number.isFinite(start) && Number.isFinite(finish) && finish >= start
				? (finish - start) / 1000
				: 0;
	}
	return {
		runId: p.runId || "",
		startedAt: p.startedAt || "",
		finishedAt: p.finishedAt || "",
		persona: p.persona || "",
		trigger: p.trigger || "loop",
		projectName: p.projectName || "",
		repo: p.repo || "",
		issueNumber: p.issueNumber ?? null,
		prNumber: p.prNumber ?? null,
		status: p.status || "ok",
		action: p.action || "ran",
		reason: p.reason || "",
		error: p.error || "",
		tokensInput,
		tokensOutput,
		tokensTotal: Number(p.tokensTotal) || tokensInput + tokensOutput,
		durationSeconds,
		gitSha: p.gitSha || "",
	};
}

/**
 * Read all run records from `runs.jsonl` (defensively, skipping malformed lines).
 * @param {string} workspace
 * @returns {Promise<Array<object>>}
 */
export async function readRuns(workspace) {
	const { runs } = logPaths(workspace);
	try {
		const raw = await readFile(runs, "utf8");
		const out = [];
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				out.push(JSON.parse(t));
			} catch {
				// skip malformed
			}
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Read all error records from `errors.jsonl`.
 * @param {string} workspace
 * @returns {Promise<Array<object>>}
 */
export async function readErrors(workspace) {
	const { errors } = logPaths(workspace);
	try {
		const raw = await readFile(errors, "utf8");
		const out = [];
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				out.push(JSON.parse(t));
			} catch {
				// skip malformed
			}
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Accumulate token usage into `usage.jsonl` — one record per day (and per loop
 * cycle) so the M13 budget guard and `/status` can read per-day/per-cycle totals.
 *
 * Each record: { date, cycle, tokensInput, tokensOutput, tokensTotal, runs }.
 * A new record is appended per call (additive, not overwriting) so downstream
 * readers sum by date/cycle.
 *
 * @param {string} workspace
 * @param {object} usage  { tokensInput, tokensOutput, tokensTotal, cycle? }
 * @param {object} [config]
 * @returns {Promise<object>} the appended usage record
 */
export async function accumulateTokens(workspace, usage = {}, config = {}) {
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const tokensInput = Number(usage.tokensInput) || 0;
	const tokensOutput = Number(usage.tokensOutput) || 0;
	const record = {
		date,
		cycle: Number(usage.cycle) || 0,
		tokensInput,
		tokensOutput,
		tokensTotal: Number(usage.tokensTotal) || tokensInput + tokensOutput,
		runs: Number(usage.runs) || 1,
		at: now.toISOString(),
	};
	await appendJsonl(workspace, USAGE_LOG_REL, record, config);
	return record;
}

/**
 * Read the accumulated token usage, summed per day and per cycle.
 *
 * @param {string} workspace
 * @returns {Promise<{ byDay: object, byCycle: object, totals: { tokensInput, tokensOutput, tokensTotal, runs } }>}
 */
export async function readUsage(workspace) {
	const { usage } = logPaths(workspace);
	const byDay = {};
	const byCycle = {};
	const totals = { tokensInput: 0, tokensOutput: 0, tokensTotal: 0, runs: 0 };
	try {
		const raw = await readFile(usage, "utf8");
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				const r = JSON.parse(t);
				const day = r.date || "unknown";
				const cycle = String(r.cycle ?? 0);
				byDay[day] = byDay[day] || { tokensInput: 0, tokensOutput: 0, tokensTotal: 0, runs: 0 };
				byCycle[cycle] = byCycle[cycle] || { tokensInput: 0, tokensOutput: 0, tokensTotal: 0, runs: 0 };
				for (const key of ["tokensInput", "tokensOutput", "tokensTotal", "runs"]) {
					byDay[day][key] += Number(r[key]) || 0;
					byCycle[cycle][key] += Number(r[key]) || 0;
					totals[key] += Number(r[key]) || 0;
				}
			} catch {
				// skip malformed
			}
		}
	} catch {
		// none yet
	}
	return { byDay, byCycle, totals };
}

/**
 * Estimate the cost in USD for a token count using a rough per-1M-token rate.
 * The default is a conservative blended input/output rate; projects may
 * override via `config.logging.estimatedCostPer1MTokens`.
 *
 * @param {number} tokensTotal
 * @param {object} [config]
 * @returns {number} cost in USD
 */
export function estimateCost(tokensTotal, config = {}) {
	const rate = Number(config?.logging?.estimatedCostPer1MTokens) || 4; // $4 / 1M blended
	return (Number(tokensTotal) || 0) / 1_000_000 * rate;
}

/**
 * Read a `{workspace}/.pi/state/initiation.json`-style project state summary
 * for the summary.md "project state" section. Best-effort.
 *
 * @param {string} workspace
 * @returns {Promise<{ status: string, milestone?: string }>}
 */
export async function readProjectState(workspace) {
	try {
		const raw = await readFile(join(workspace, ".pi", "state", "initiation.json"), "utf8");
		const init = JSON.parse(raw);
		return {
			status: String(init?.status || "active"),
			milestone: init?.milestone || "",
		};
	} catch {
		return { status: "active", milestone: "" };
	}
}

/**
 * Build the markdown execution summary (plan.md §20.2) and the record that is
 * appended to `summary.jsonl`.
 *
 * @param {object} p
 * @param {string} [p.workspace]
 * @param {object} [p.config]     parsed config (project name, repo, logging)
 * @param {object} [p.state]      scanned GitHub state (issues, prs, merged)
 * @param {object} [p.usage]      { byDay, byCycle, totals } from readUsage
 * @param {object} [p.lastRun]    most recent run record (optional)
 * @param {object} [p.errors]     recent error records (optional)
 * @returns {Promise<{ md: string, record: object }>}
 */
export async function buildSummary({ workspace, config = {}, state = {}, usage, lastRun, errors = [] }) {
	const now = new Date().toISOString();
	const today = now.slice(0, 10);
	const project = config?.project || {};

	// Runs for today from the runs ledger (or the passed usage).
	const runs = lastRun ? [lastRun] : await readRuns(workspace || "");
	const todayRuns = runs.filter((r) => String(r.startedAt || "").slice(0, 10) === today);
	const okCount = todayRuns.filter((r) => r.status === "ok" || r.action === "ran").length;
	const failCount = todayRuns.filter((r) => r.status === "error" || r.action === "error").length;

	const usageData = usage || (await readUsage(workspace || ""));
	const todayUsage = usageData.byDay?.[today] || usageData.totals || { tokensTotal: 0 };
	const tokensTotal = Number(todayUsage.tokensTotal) || 0;
	const costUsd = estimateCost(tokensTotal, config);

	// Active work.
	const openIssues = Array.isArray(state?.issues) ? state.issues : [];
	const openPrs = Array.isArray(state?.prs) ? state.prs : [];
	const lastMerged = state?.mergedPrs?.[0] || null;

	const lines = [];
	lines.push(`# auto-pi execution summary`);
	lines.push(``);
	lines.push(`Generated: ${now}`);
	lines.push(``);

	// Last run info.
	lines.push(`## Last run`);
	lines.push(``);
	if (lastRun && lastRun.runId) {
		lines.push(`- Run: \`${lastRun.runId}\``);
		lines.push(`- Persona: **${lastRun.persona || "unknown"}**`);
		lines.push(`- Status: **${lastRun.status || lastRun.action || "unknown"}**`);
		lines.push(`- Action: ${lastRun.action || ""}`);
		lines.push(`- Reason: ${lastRun.reason || ""}`);
		lines.push(`- Started: ${lastRun.startedAt || ""}`);
		lines.push(`- Finished: ${lastRun.finishedAt || ""}`);
		lines.push(`- Duration: ${lastRun.durationSeconds || 0}s`);
		if (lastRun.error) lines.push(`- Error: ${lastRun.error}`);
		if (lastRun.gitSha) lines.push(`- Git SHA: ${lastRun.gitSha}`);
	} else {
		lines.push(`No persona runs recorded yet.`);
	}
	lines.push(``);

	// Today's totals.
	lines.push(`## Today (${today})`);
	lines.push(``);
	lines.push(`- Runs: ${todayRuns.length} (ok: ${okCount}, fail: ${failCount})`);
	lines.push(`- Tokens used: ${tokensTotal.toLocaleString()}`);
	lines.push(`- Estimated cost: $${costUsd.toFixed(4)}`);
	lines.push(``);

	// Active work.
	lines.push(`## Active work`);
	lines.push(``);
	if (openIssues.length) {
		lines.push(`### Open issues (${openIssues.length})`);
		for (const i of openIssues.slice(0, 10)) {
			lines.push(`- #${i.number} ${i.title} [${(i.labels || []).join(", ") || "no labels"}]`);
		}
		lines.push(``);
	} else {
		lines.push(`No open issues.`);
		lines.push(``);
	}
	if (openPrs.length) {
		lines.push(`### Open PRs (${openPrs.length})`);
		for (const p of openPrs.slice(0, 10)) {
			lines.push(`- #${p.number} ${p.title} (review: ${p.review || "none"}, mergeable: ${p.mergeable})`);
		}
		lines.push(``);
	} else {
		lines.push(`No open PRs.`);
		lines.push(``);
	}
	if (lastMerged) {
		lines.push(`### Last merged PR`);
		lines.push(`- #${lastMerged.number} ${lastMerged.title}`);
		lines.push(``);
	}

	// Project state.
	const ps = await readProjectState(workspace || "");
	lines.push(`## Project state`);
	lines.push(``);
	lines.push(`- Name: ${project.name || ""}`);
	lines.push(`- Repo: ${project.owner || ""}/${project.repo || ""}`);
	lines.push(`- Status: ${ps.status}`);
	if (ps.milestone) lines.push(`- Milestone: ${ps.milestone}`);
	lines.push(``);

	// Recent errors.
	if (errors.length) {
		lines.push(`## Recent errors (${errors.length})`);
		lines.push(``);
		for (const e of errors.slice(0, 5)) {
			lines.push(`- ${e.at || ""} ${e.persona ? `[${e.persona}] ` : ""}${e.error || ""}`);
		}
		lines.push(``);
	}

	const md = lines.join("\n");

	const record = {
		version: SUMMARY_VERSION,
		generatedAt: now,
		date: today,
		lastRun: lastRun ? {
			runId: lastRun.runId,
			persona: lastRun.persona,
			status: lastRun.status || lastRun.action,
			action: lastRun.action,
		} : null,
		runsToday: todayRuns.length,
		okToday: okCount,
		failToday: failCount,
		tokensToday: tokensTotal,
		costTodayUsd: costUsd,
		openIssues: openIssues.length,
		openPrs: openPrs.length,
		projectState: ps.status,
	};

	return { md, record };
}

/**
 * Write the execution summary: `summary.md` (human) and append `summary.jsonl`
 * (machine). Also refreshes `latest.log` with a short activity line. Redacts
 * secrets from everything written.
 *
 * @param {object} p  same as buildSummary: { workspace, config, state, usage, lastRun, errors }
 * @returns {Promise<{ md: string, record: object, paths: object }>}
 */
export async function writeSummary(p) {
	const { workspace, config = {} } = p;
	const { md, record } = await buildSummary(p);
	const paths = logPaths(workspace);
	await ensureLogDir(workspace);
	await writeFile(paths.summaryMd, redactSecrets(md) + "\n", "utf8");
	await appendJsonl(workspace, SUMMARY_JSONL_REL, record, config);
	await writeLatestLog(workspace, `summary written at ${record.generatedAt} (runs today: ${record.runsToday}, tokens: ${record.tokensToday})`);
	return { md, record, paths };
}

/**
 * Convenience: read the last N run records (most recent first).
 * @param {string} workspace
 * @param {number} [n]
 * @returns {Promise<Array<object>>}
 */
export async function lastRuns(workspace, n = 10) {
	const runs = await readRuns(workspace);
	return runs.slice(-n).reverse();
}

/**
 * Convenience: read the most recent run record, or null.
 * @param {string} workspace
 * @returns {Promise<object|null>}
 */
export async function lastRun(workspace) {
	const runs = await readRuns(workspace);
	return runs.length ? runs[runs.length - 1] : null;
}
