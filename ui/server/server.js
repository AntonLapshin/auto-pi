#!/usr/bin/env node
/**
 * auto-pi UI backend server.
 *
 * A lightweight, dependency-free Node HTTP server that reads the active
 * project's local `.pi/logs/` ledgers (runs.jsonl, events.jsonl, health.jsonl,
 * errors.jsonl, usage.jsonl, summary.jsonl) and exposes them as a JSON API for
 * the Vite + React dashboard.
 *
 *   node ui/server/server.js [--port 8787] [--host 127.0.0.1]
 *
 * The port/host can also be set via AUTOPI_UI_PORT / AUTOPI_UI_HOST.
 * CLI flags win over env vars. The server binds to 127.0.0.1 by default
 * (local use). For LAN polling (e.g. an ESP32 pocket monitor on the same
 * Wi-Fi), run with `--host 0.0.0.0` (or AUTOPI_UI_HOST=0.0.0.0) and query
 * `http://<lan-ip>:8787/api/esp-status` — note the `:8787` port. Querying
 * `http://<lan-ip>/api/esp-status` (implicit port 80) will refuse/time out
 * because nothing listens on port 80.
 *
 * Endpoints (all read-only, no auth — intended for local use):
 *   GET /api/status   project identity, loop state, active persona, budget
 *   GET /api/events   structured progress-event timeline
 *   GET /api/runs     persona run records
 *   GET /api/health   LLM-provider health (success rate, failures, retries)
 *   GET /api/usage    token usage per day
 *   GET /api/errors   recent errors
 *   GET /api/summary  latest machine-readable execution summary
 *   GET /api/esp-status tiny ESP32 pocket-monitor payload (v10: proj/loop,
 *                     stuck, persona, model, lastAction/lastActionAgoS last
 *                     meaningful action, last10PersonaStatus persona-run bar
 *                     history, lastPersonaCallFinished liveness,
 *                     last10LlmStatus per-turn LLM bar history,
 *                     lastLlmCallFinished per-turn liveness)
 *
 * The active project is resolved from `~/.auto-pi/current-project.json` (same
 * record the loop writes at seed time). If no project is active, endpoints
 * return a 404 with an `{ error }` body.
 */

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
	readRuns,
	readErrors,
	readUsage,
	readEvents,
	readHealth,
	readLlmCalls,
	logPaths,
} from "../../skills/logging/core.js";
import { readActiveProject, checkLock } from "../../extensions/loop/orchestrator.js";
import { resolveProviderModel } from "../../extensions/loop/provider-env.js";

const CURRENT_PROJECT_FILE = join(homedir(), ".auto-pi", "current-project.json");

/**
 * Parse the UI server bind address from CLI args + env.
 * CLI flags (`--port N`, `--host H`) win over `AUTOPI_UI_PORT` /
 * `AUTOPI_UI_HOST`. Defaults: port 8787, host 127.0.0.1.
 */
export function parseUiBind(argv = process.argv.slice(2), env = process.env) {
	let port = Number(env.AUTOPI_UI_PORT) || 8787;
	let host = env.AUTOPI_UI_HOST || "127.0.0.1";
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if ((a === "--port" || a === "--port=") && argv[i + 1] !== undefined) {
			const n = Number(argv[i + 1]);
			if (Number.isFinite(n) && n > 0) port = n;
			i += 1;
		} else if (a.startsWith("--port=")) {
			const n = Number(a.slice("--port=".length));
			if (Number.isFinite(n) && n > 0) port = n;
		} else if ((a === "--host") && argv[i + 1] !== undefined) {
			host = String(argv[i + 1]);
			i += 1;
		} else if (a.startsWith("--host=")) {
			host = String(a.slice("--host=".length));
		}
	}
	return { port, host };
}

const { port: PORT, host: HOST } = parseUiBind();

/** Resolve the active project workspace (or null). */
async function resolveActive() {
	const res = await readActiveProject(CURRENT_PROJECT_FILE);
	if (!res.ok || !res.active?.workspace) return null;
	return res.active;
}

/** Read the parsed project config (best-effort). */
async function readConfig(workspace) {
	try {
		const raw = await readFile(join(workspace, ".pi", "config.json"), "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * Best-effort check: is the `pi` child process for this persona run still
 * alive? The loop runs each persona as `pi -p --session-id <runId> ...`, so a
 * live process carrying that session id means a persona run is still in flight
 * (the persona is actively working, even if no ledger row has been written
 * yet — health/events are only appended when a run finishes or retries).
 * Never throws; returns false when the scan fails so callers fall back to the
 * ledger-only behaviour.
 */
const execFileAsync = promisify(execFile);
export async function isPersonaProcessAlive(runId, workspace = "") {
	const wantId = typeof runId === "string" && runId && runId !== "[REDACTED]" ? runId : "";
	if (!wantId && !workspace) return false;
	try {
		const { stdout } = await execFileAsync("ps", ["-eo", "pid,args"], { timeout: 3000 });
		for (const line of String(stdout || "").split("\n")) {
			const m = line.trim().match(/^(\d+)\s+(.*)$/);
			if (!m) continue;
			const [, pid, args] = m;
			// The loop runs each persona as `pi -p --session-id <runId> ...`.
			if (wantId && args.includes("--session-id") && args.includes(wantId)) return true;
			// Fallback when the run ID is missing/redacted in the ledgers: any
			// live process carrying a pi persona session (`--session-id`,
			// which only persona children use) and rooted in this workspace
			// means a persona run is in flight for the project.
			if (workspace && args.includes("--session-id")) {
				try {
					const { readlink } = await import("node:fs/promises");
					const cwd = await readlink(`/proc/${pid}/cwd`);
					if (cwd === workspace) return true;
				} catch {
					// process exited mid-scan or cwd unreadable — keep scanning
				}
			}
		}
		return false;
	} catch {
		return false;
	}
}

/** Read loop lock state (running / pid / startedAt). */
async function loopState(workspace) {
	const lock = await checkLock(workspace);
	const stopFile = join(workspace, ".pi", "state", "stop");
	return {
		running: lock.locked,
		pid: lock.pid,
		stale: lock.stale,
		stopFilePresent: existsSync(stopFile),
	};
}

/** Determine the currently-active persona from the most recent run record. */
function activePersona(runs) {
	if (!runs.length) return null;
	const last = runs[runs.length - 1];
	// A persona is "active" if the last record is a started/running marker that
	// has no matching finished record after it.
	if (last.status === "started" || last.status === "running") {
		return { persona: last.persona, runId: last.runId, startedAt: last.startedAt, status: last.status };
	}
	return null;
}

/** Aggregate LLM-provider health into a success-rate summary. */
function healthSummary(health) {
	const byProvider = {};
	let total = 0;
	let ok = 0;
	let retries = 0;
	for (const h of health) {
		total += 1;
		if (h.ok) ok += 1;
		retries += Number(h.retries) || 0;
		const key = h.provider || "unknown";
		byProvider[key] = byProvider[key] || { total: 0, ok: 0, failures: [] };
		byProvider[key].total += 1;
		if (h.ok) byProvider[key].ok += 1;
		if (!h.ok) {
			byProvider[key].failures.push({
				at: h.at,
				persona: h.persona,
				reason: (h.reason || "").slice(0, 160),
				retryable: h.retryable,
			});
		}
	}
	const recent = health.slice(0, 50);
	const recentOk = recent.filter((h) => h.ok).length;
	// Only count the last invocation per run as the "outcome" for success rate
	// (retry attempts are also recorded, so dedupe by runId keeping the last).
	const outcomes = new Map();
	for (const h of health) {
		outcomes.set(h.runId || h.at, h);
	}
	const outcomeArr = [...outcomes.values()];
	const outcomeOk = outcomeArr.filter((h) => h.ok).length;
	return {
		total,
		ok,
		successRate: total ? Math.round((ok / total) * 1000) / 10 : 0,
		outcomeSuccessRate: outcomeArr.length
			? Math.round((outcomeOk / outcomeArr.length) * 1000) / 10
			: 0,
		recentSuccessRate: recent.length ? Math.round((recentOk / recent.length) * 1000) / 10 : 0,
		totalRetries: retries,
		byProvider,
		recentFailures: health.filter((h) => !h.ok).slice(0, 10),
	};
}

/** Aggregate persona stats from run records. */
function personaStats(runs) {
	const byPersona = {};
	const counts = { ok: 0, error: 0, waiting: 0, stopped: 0, started: 0 };
	for (const r of runs) {
		const key = r.persona || "unknown";
		byPersona[key] = byPersona[key] || { runs: 0, ok: 0, error: 0, tokensTotal: 0, durationSeconds: 0 };
		byPersona[key].runs += 1;
		byPersona[key].tokensTotal += Number(r.tokensTotal) || 0;
		byPersona[key].durationSeconds += Number(r.durationSeconds) || 0;
		const st = r.status || r.action;
		if (st === "ok" || st === "ran") { byPersona[key].ok += 1; }
		if (st === "error") { byPersona[key].error += 1; }
		if (counts[st] !== undefined) counts[st] += 1;
	}
	return { byPersona, counts };
}

/** Build the full status payload. */
async function buildStatus(active) {
	const workspace = active.workspace;
	const config = await readConfig(workspace);
	const [runs, errors, usage, events, health] = await Promise.all([
		readRuns(workspace),
		readErrors(workspace),
		readUsage(workspace),
		readEvents(workspace),
		readHealth(workspace),
	]);
	const today = new Date().toISOString().slice(0, 10);
	const todayUsage = usage.byDay?.[today] || usage.totals || { tokensTotal: 0, runs: 0 };
	const loop = await loopState(workspace);
	const stats = personaStats(runs);
	const activeP = activePersona(runs);

	// Resolve the *effective* provider/model the loop uses (project config →
	// PI_* env → pi user settings), so the monitor shows the real provider even
	// when the project config leaves `pi.provider`/`pi.model` empty and the loop
	// falls back to env/settings (see extensions/loop/provider-env.js).
	const effective = resolveProviderModel({ config });

	return {
		project: {
			name: active.projectName || config?.project?.name || "",
			repo: active.repo || "",
			workspace,
			startedAt: active.startedAt || "",
		},
		config: config
			? {
					model: effective.model || config.pi?.model || "",
					provider: effective.provider || config.pi?.provider || "",
					intervalSeconds: config.loop?.intervalSeconds,
					limits: config.limits || {},
				}
			: null,
		loop,
		activePersona: activeP,
		stats,
		usage: {
			today: {
				tokensTotal: Number(todayUsage.tokensTotal) || 0,
				runs: Number(todayUsage.runs) || 0,
			},
			totals: usage.totals || { tokensTotal: 0, runs: 0 },
			byDay: Object.entries(usage.byDay || {}).map(([date, v]) => ({
				date,
				tokensTotal: v.tokensTotal,
				runs: v.runs,
			})).slice(-14),
			byHour: Object.entries(usage.byHour || {}).map(([hour, v]) => ({
				hour,
				tokensTotal: v.tokensTotal,
				runs: v.runs,
			})).slice(-24),
		},
		health: healthSummary(health),
		counts: {
			runs: runs.length,
			errors: errors.length,
			events: events.length,
		},
		generatedAt: new Date().toISOString(),
	};
}

/** Read the latest machine-readable summary record. */
async function readLatestSummary(workspace) {
	const { summaryJsonl } = logPaths(workspace);
	try {
		const raw = await readFile(summaryJsonl, "utf8");
		const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
		if (!lines.length) return null;
		return JSON.parse(lines[lines.length - 1]);
	} catch {
		return null;
	}
}

/** GitHub-visible progress events: the only thing that counts as a
 * "meaningful action" for the pocket monitor. Heartbeats (`persona.spawned`,
 * `loop.dispatch`, `llm.retry`, `git.status/log/diff`) are excluded on
 * purpose — green must mean GitHub side-effects, not LLM chatter. */
export const MEANINGFUL_EVENT_TYPES = new Set([
	"issue.created",
	"issue.closed",
	"issue.edited",
	"pr.created",
	"pr.merged",
	"pr.approved",
	"pr.changes_requested",
	"pr.reviewed",
	"pr.commented",
	"pr.ready",
	"pr.closed",
	"labels.assigned",
	"git.push",
	"git.commit",
	"git.merge",
]);

/** True when the event is a GitHub-visible meaningful action. */
export function isMeaningfulEvent(e) {
	return Boolean(e && MEANINGFUL_EVENT_TYPES.has(e.type));
}

/** Extract the first standalone number (issue/PR number) from a command. */
function extractNumber(cmd) {
	const m = String(cmd || "").match(/(?:issue|pr)\s+\S+\s+#?(\d{1,6})/i)
		|| String(cmd || "").match(/\s#(\d{1,6})\b/)
		|| String(cmd || "").match(/\s(\d{1,6})\s*$/);
	return m ? m[1] : "";
}

/** Short human label for the ESP32 (<=40 chars): "merged PR #12", "filed ticket", ... */
export function humanizeMeaningfulEvent(e) {
	const type = String(e?.type || "");
	const cmd = String(e?.data?.command || "");
	// Prefer an explicit number carried on the event (e.g. backfilled or
	// API-observed PR/issue numbers); fall back to parsing the command text.
	// `gh pr create` commands carry no number, so without this an opened PR
	// renders numberless even when the PR number is known.
	const explicit = e?.data?.prNumber ?? e?.data?.issueNumber ?? e?.data?.number;
	const n = (explicit !== undefined && explicit !== null && String(explicit).trim() !== "")
		? String(explicit).trim()
		: extractNumber(cmd);
	switch (type) {
		case "issue.created": return n ? `filed ticket #${n}` : "filed ticket";
		case "issue.closed": return n ? `closed #${n}` : "closed ticket";
		case "issue.edited": return n ? `edited #${n}` : "edited ticket";
		case "pr.created": return n ? `opened PR #${n}` : "opened PR";
		case "pr.merged": return n ? `merged PR #${n}` : "merged PR";
		case "pr.approved": return n ? `approved PR #${n}` : "approved PR";
		case "pr.changes_requested": return n ? `review #${n}: changes` : "review: changes";
		case "pr.reviewed": return n ? `reviewed PR #${n}` : "reviewed PR";
		case "pr.commented": return n ? `commented PR #${n}` : "commented PR";
		case "pr.ready": return n ? `PR #${n} ready` : "PR ready";
		case "pr.closed": return n ? `closed PR #${n}` : "closed PR";
		case "labels.assigned": return n ? `labeled #${n}` : "labeled";
		case "git.push": {
			const parts = cmd.trim().split(/\s+/);
			let branch = parts[parts.length - 1] || "";
			if (!branch || branch.startsWith("-") || branch.includes("origin") && parts.length < 4) branch = "";
			// `git push origin <branch>` -> last token is the branch.
			if (parts.length >= 4 && parts[0] === "git" && parts[1] === "push") {
				branch = parts[parts.length - 1].startsWith("-") ? "" : parts[parts.length - 1];
				if (branch === "origin" || branch === "--force" || branch === "-f") branch = "";
			}
			return (branch ? `pushed ${branch}` : "pushed").slice(0, 40);
		}
		case "git.commit": return "committed";
		case "git.merge": return "merged branch";
		default: return type.slice(0, 40) || "did something";
	}
}

/** Build the tiny ESP-optimized status payload (LAN polling).
 * v10 layout contract (170x320 portrait) — trimmed to what the display shows:
 *   Project (Loop)  -> `proj`, `loop` (`ON`/`OFF` badge + header color)
 *   Stuck           -> `stuck` bool (active record older than
 *                      loop.personaTimeoutMs, or silent longer than
 *                      loop.personaInactivityMs with NO live `pi` child for the
 *                      run, or active while the loop is dead — a live child
 *                      means a persona run is in flight, i.e. actively working);
 *                      firmware renders large red STUCK
 *   LLM active      -> `llmActive` bool (active run with a live `pi` child:
 *                      a persona run is in flight even when
 *                      `lastPersonaCallFinished`/`lastLlmCallFinished` are
 *                      stale); render as e.g. "working…" (v9 additive field,
 *                      old firmware ignores it)
 *   Persona         -> `persona` (pm | engineer | review-engineer | ...)
 *   Model           -> `model` (effective pi model; `provider` removed in v8
 *                      to save space — see /api/status for provider detail)
 *   Last action     -> `lastAction` (e.g. "merged PR #12") +
 *                      `lastActionAgoS` (seconds since it happened, -1 when
 *                      none); render as e.g. "commit 3m ago"
 *   Persona bars    -> `last10PersonaStatus` (up to 10 booleans, newest first;
 *                      `true` = green bar, `false` = red bar) from
 *                      `health.jsonl` (one record per whole persona-run
 *                      invocation outcome + one per retry)
 *   Persona liveness -> `lastPersonaCallFinished` (seconds since the newest
 *                      `health.jsonl` record, ok or fail — i.e. the last
 *                      FINISHED persona run; -1 when none); render as e.g.
 *                      "last persona run 5m ago" (stale while a run is in
 *                      flight — see `llmActive`)
 *   LLM bars        -> `last10LlmStatus` (up to 10 booleans, newest first;
 *                      `true` = green bar, `false` = red bar) from `llm.jsonl`
 *                      (one record per individual finished LLM turn inside a
 *                      persona's `pi` session)
 *   LLM liveness    -> `lastLlmCallFinished` (seconds since the newest
 *                      `llm.jsonl` record, ok or fail — i.e. the last
 *                      FINISHED individual LLM turn; -1 when none); render as
 *                      e.g. "last llm call 30s ago"
 * v9 fields `last10LlmStatus`/`lastLlmCallFinished` meant persona runs and
 * were renamed in v10 (`last10PersonaStatus`/`lastPersonaCallFinished`);
 * the v10 `last10LlmStatus`/`lastLlmCallFinished` are true per-turn LLM
 * calls. Old v9 firmware reading `last10LlmStatus` now sees true LLM bars.
 * v8 fields (`status`, `state`, `ok_n`/`fail_n`, `run_id`/`run_ok_n`,
 * `act`/`act_t`/`act_ago_s`, `ago_s`, `last`, `tok_today`, `err`, `at`)
 * were removed in v9 — old firmware must upgrade. */
export async function buildEspStatus(active, opts = {}) {
	const workspace = active.workspace;
	const config = await readConfig(workspace);
	const [runs, events, health, llmCalls] = await Promise.all([
		readRuns(workspace),
		readEvents(workspace, { limit: 200 }),
		readHealth(workspace, { limit: 100 }),
		readLlmCalls(workspace, { limit: 100 }),
	]);
	const loop = await loopState(workspace);
	const now = Date.now();
	const lastRun = runs.length ? runs[runs.length - 1] : null;

	// Last-10 persona-run outcomes (health.jsonl is most-recent-first, head it):
	// newest first, `true` = success (green bar), `false` = fail (red bar).
	const personaWin = health.slice(0, 10);
	const last10PersonaStatus = personaWin.map((h) => Boolean(h.ok));
	// Seconds since the last persona run finished (success or fail), -1 if none.
	const lastPersonaMs = Date.parse(personaWin[0]?.at || "");
	const lastPersonaCallFinished = Number.isFinite(lastPersonaMs)
		? Math.max(0, Math.floor((now - lastPersonaMs) / 1000))
		: -1;

	// Last-10 individual LLM-turn outcomes (llm.jsonl, most-recent-first):
	// newest first, `true` = success (green bar), `false` = fail (red bar).
	const llmWin = llmCalls.slice(0, 10);
	const last10LlmStatus = llmWin.map((h) => Boolean(h.ok));
	// Seconds since the last individual LLM turn finished, -1 if none.
	const lastLlmMs = Date.parse(llmWin[0]?.at || "");
	const lastLlmCallFinished = Number.isFinite(lastLlmMs)
		? Math.max(0, Math.floor((now - lastLlmMs) / 1000))
		: -1;

	// Model: effective resolution (config -> PI_* env -> pi settings), then
	// the most recent non-empty model in health.jsonl / llm.jsonl. Truncated
	// for the tiny display; "-" when unknown.
	let model = String(resolveProviderModel({ config }).model || "").slice(0, 48);
	if (!model) {
		for (let i = 0; i < health.length; i += 1) {
			const m = String(health[i]?.model || "").trim();
			if (m) { model = m.slice(0, 48); break; }
		}
	}
	if (!model) {
		for (let i = 0; i < llmCalls.length; i += 1) {
			const m = String(llmCalls[i]?.model || "").trim();
			if (m) { model = m.slice(0, 48); break; }
		}
	}
	if (!model) {
		// Retry/failure entries carry no model, so a long outage can bury the
		// last model-bearing record below the 100-row window above. Rescan
		// deeper (the 1000-row window the pre-v8 endpoint used) before "-".
		try {
			const deep = await readHealth(workspace, { limit: 1000 });
			for (let i = health.length; i < deep.length; i += 1) {
				const m = String(deep[i]?.model || "").trim();
				if (m) { model = m.slice(0, 48); break; }
			}
		} catch {
			// best-effort — display falls back to "-" below
		}
	}
	model = model || "-";

	// Persona: active persona first (a started run means that persona is live),
	// otherwise the last run's persona.
	let persona = String(lastRun?.persona || "");
	if (lastRun && (lastRun.status === "started" || lastRun.status === "running")) {
		persona = String(lastRun.persona || persona);
	}
	persona = (persona || "-").slice(0, 24);

	// Last meaningful action: newest meaningful event (most-recent-first scan).
	let lastAction = "-";
	let lastActionAgoS = -1;
	for (const e of events) {
		if (!isMeaningfulEvent(e)) continue;
		lastAction = humanizeMeaningfulEvent(e).slice(0, 40);
		const ms = Date.parse(e.at || "");
		lastActionAgoS = Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 1000)) : -1;
		break;
	}

	// Liveness: stuck vs active vs idle, driven by loop config
	// (loop.personaInactivityMs / personaTimeoutMs, defaults mirror
	// config/config.default.json so a missing config still behaves).
	//
	// Activity = newest of run start, newest event, newest persona-run record.
	// Health counts so failed persona runs (retries) prove the persona is working.
	// When the ledgers go silent past the inactivity watchdog we additionally
	// check whether the run's `pi` child is still alive: a live child means a
	// persona run is in flight (actively working — health/events are only written
	// when a run finishes or retries), so it is NOT stuck. The single-run
	// timeout is the wall-clock cap below, enforced by the loop itself
	// (executePi kills + retries a hung persona). Only a silent run with NO
	// live child — the loop wedged between ledger writes — is stuck.
	const inactivityMs = Number(config?.loop?.personaInactivityMs) > 0
		? Number(config.loop.personaInactivityMs) : 600000;
	const timeoutMs = Number(config?.loop?.personaTimeoutMs) > 0
		? Number(config.loop.personaTimeoutMs) : 3600000;
	const activeP = Boolean(
		lastRun && (lastRun.status === "started" || lastRun.status === "running"),
	);
	const stopped = Boolean(loop.stopFilePresent);
	const effectiveRunning = Boolean(loop.running && !stopped);
	const startedMs = Date.parse(lastRun?.startedAt || "");
	const timedOut = Boolean(activeP) && Number.isFinite(startedMs) && now - startedMs > timeoutMs;
	let stuck = false;
	let llmActive = false;
	if (activeP) {
		if (!loop.running) {
			stuck = true; // persona marked active but the loop is dead
		} else if (timedOut) {
			stuck = true; // exceeded the wall-clock cap
		} else {
			const newestEventMs = Date.parse(events[0]?.at || "");
			const newestHealthMs = Date.parse(health[0]?.at || "");
			const newestLlmMs = Date.parse(llmCalls[0]?.at || "");
			// NB: Math.max with ANY NaN operand returns NaN, so filter first —
			// a missing signal (e.g. no health rows yet) must not poison the
			// watchdog into never firing.
			const candidates = [startedMs, newestEventMs, newestHealthMs, newestLlmMs].filter(Number.isFinite);
			const lastActivityMs = candidates.length ? Math.max(...candidates) : NaN;
			const silent = Number.isFinite(lastActivityMs) && now - lastActivityMs > inactivityMs;
			const checkAlive = typeof opts?.isPersonaAlive === "function"
				? opts.isPersonaAlive
				: isPersonaProcessAlive;
			const childAlive = effectiveRunning
				? await checkAlive(lastRun?.runId, workspace).catch(() => false)
				: false;
			llmActive = effectiveRunning && !timedOut && Boolean(childAlive);
			if (silent && !childAlive) {
				stuck = true; // silent longer than the watchdog with no live child
			}
		}
	}

	return {
		ok: true,
		proj: String(active.projectName || "").slice(0, 24),
		loop: effectiveRunning,
		stuck,
		llmActive,
		persona,
		model,
		lastAction,
		lastActionAgoS,
		last10PersonaStatus,
		lastPersonaCallFinished,
		last10LlmStatus,
		lastLlmCallFinished,
	};
}

function sendJson(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
		"Cache-Control": "no-store",
	});
	res.end(data);
}

function sendError(res, status, message) {
	sendJson(res, status, { error: message });
}

/** Parse an int query param with a default. */
function qint(url, name, def) {
	const v = new URL(url, "http://localhost").searchParams.get(name);
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : def;
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");
	const path = url.pathname;

	// CORS preflight (for Vite dev on a different port).
	if (req.method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "*",
		});
		res.end();
		return;
	}

	try {
		if (path === "/api/status") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const payload = await buildStatus(active);
			return sendJson(res, 200, payload);
		}

		if (path === "/api/events") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const limit = qint(req.url, "limit", 200);
			const events = await readEvents(active.workspace, { limit });
			return sendJson(res, 200, { events, count: events.length });
		}

		if (path === "/api/runs") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const limit = qint(req.url, "limit", 100);
			const runs = await readRuns(active.workspace);
			return sendJson(res, 200, { runs: runs.slice(-limit).reverse(), count: runs.length });
		}

		if (path === "/api/health") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const health = await readHealth(active.workspace, { limit: 500 });
			return sendJson(res, 200, { summary: healthSummary(health), records: health.slice(0, 50) });
		}

		if (path === "/api/usage") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const usage = await readUsage(active.workspace);
			return sendJson(res, 200, {
				byDay: Object.entries(usage.byDay || {}).map(([date, v]) => ({ date, ...v })),
				byHour: Object.entries(usage.byHour || {}).map(([hour, v]) => ({ hour, ...v })),
				byCycle: Object.entries(usage.byCycle || {}).map(([cycle, v]) => ({ cycle, ...v })),
				totals: usage.totals,
			});
		}

		if (path === "/api/errors") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const limit = qint(req.url, "limit", 50);
			const errors = await readErrors(active.workspace);
			return sendJson(res, 200, { errors: errors.slice(-limit).reverse(), count: errors.length });
		}

		if (path === "/api/summary") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const summary = await readLatestSummary(active.workspace);
			return sendJson(res, 200, { summary });
		}

		if (path === "/api/esp-status") {
			const active = await resolveActive();
			if (!active) return sendError(res, 404, "No active auto-pi project found.");
			const payload = await buildEspStatus(active);
			return sendJson(res, 200, payload);
		}

		if (path === "/api/healthz") {
			return sendJson(res, 200, { ok: true, service: "auto-pi-ui", time: new Date().toISOString() });
		}

		return sendError(res, 404, `Unknown endpoint: ${path}`);
	} catch (err) {
		return sendError(res, 500, err?.message || String(err));
	}
});

export { server };

const isMain = process.argv[1] && process.argv[1].endsWith("server.js");
if (isMain) {
	server.listen(PORT, HOST, () => {
		process.stdout.write(`auto-pi UI backend listening on http://${HOST}:${PORT}\n`);
	});
}
