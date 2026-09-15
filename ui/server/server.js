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
 *   GET /api/esp-status tiny ESP32 pocket-monitor payload (v5: proj/loop,
 *                     green-red dot, provider, model, last-10 succ/total gauge, persona)
 *
 * The active project is resolved from `~/.auto-pi/current-project.json` (same
 * record the loop writes at seed time). If no project is active, endpoints
 * return a 404 with an `{ error }` body.
 */

import { createServer } from "node:http";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
	readRuns,
	readErrors,
	readUsage,
	readEvents,
	readHealth,
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

/** Build the tiny ESP-optimized status payload (LAN polling).
 * v6 layout contract (170x320 portrait):
 *   Project (Loop)  -> `proj`, `loop`
 *   GREEN/RED pulsating dot -> `status` ("green" | "red", decided server-side)
 *   Provider        -> `provider` (effective pi provider)
 *   Model           -> `model` (effective pi model, e.g. DeepSeek-V4-Flash-0731)
 *   GAUGE           -> `succ` / `total` LLM calls, windowed server-side to the
 *                      last 10 health.jsonl records (`total` capped at 10)
 *   Persona         -> `persona` (pm | engineer | review-engineer | qa | ...)
 * `ok_n` / `fail_n` carry the last-10 *finished* persona-run outcomes
 * (filtered to terminal records first, then tailed to 10, so
 * `ok_n + fail_n <= 10` by construction). The ESP32 renders its gauge
 * directly from `succ`/`total` (resp. `ok_n`/`fail_n`) without any
 * client-side delta reconstruction.
 * Legacy fields (`last`, `tok_today`, `err`) are kept so older firmware keeps
 * working during the transition. The `runs` count field was removed in v6:
 * runs.jsonl interleaves "started"/"running" markers with terminal records,
 * so a raw last-10 slice (e.g. runs:10, ok_n:4, fail_n:0) could never satisfy
 * ok_n + fail_n == runs. */
async function buildEspStatus(active) {
	const workspace = active.workspace;
	const config = await readConfig(workspace);
	const [runs, events, errors, usage, health] = await Promise.all([
		readRuns(workspace),
		readEvents(workspace, { limit: 5 }),
		readErrors(workspace),
		readUsage(workspace),
		readHealth(workspace, { limit: 1000 }),
	]);
	const loop = await loopState(workspace);
	const now = Date.now();
	const lastRun = runs.length ? runs[runs.length - 1] : null;
	const lastEvent = events.length ? events[0] : null;
	const lastAtRaw = lastRun?.finishedAt || lastRun?.startedAt || lastEvent?.at || "";
	const lastMs = Date.parse(lastAtRaw || "");
	const ago_s = Number.isFinite(lastMs) ? Math.max(0, Math.floor((now - lastMs) / 1000)) : -1;
	const today = new Date().toISOString().slice(0, 10);
	// Last-10 *finished* run outcomes. runs.jsonl is oldest-first and
	// interleaves "started"/"running" markers with terminal records, so a raw
	// tail slice can contain markers that are neither ok nor fail
	// (e.g. runs:10, ok_n:4, fail_n:0). Filter to terminal outcomes first,
	// then tail to 10: ok_n + fail_n <= 10 by construction, fewer when less
	// than 10 finished runs exist.
	const isOk = (r) => r.status === "ok" || r.action === "ran";
	const isFail = (r) => r.status === "error" || r.action === "error";
	const recentFinished = runs.filter((r) => isOk(r) || isFail(r)).slice(-10);
	const ok_n = recentFinished.filter(isOk).length;
	const fail_n = recentFinished.filter(isFail).length;
	const tok_today = Number(usage.byDay?.[today]?.tokensTotal ?? usage.totals?.tokensTotal ?? 0) || 0;
	const last = String(lastRun?.reason || lastEvent?.type || "idle").slice(0, 40);

	// Provider: effective resolution (config -> PI_* env -> pi settings), then
	// fall back to the most recent non-empty provider in health.jsonl (older
	// records were written with config-only resolution and may be empty), then
	// infer from pi's authenticated providers (auth.json holds keys per
	// provider — we expose only the name, never the key), then GONKA env hint.
	let provider = String(resolveProviderModel({ config }).provider || "").slice(0, 24);
	if (!provider) {
		// readHealth() returns most-recent-first, so index 0 is the newest.
		for (let i = 0; i < health.length; i += 1) {
			const p = String(health[i]?.provider || "").trim();
			if (p) { provider = p.slice(0, 24); break; }
		}
	}
	if (!provider) {
		try {
			const auth = JSON.parse(
				await readFile(join(homedir(), ".pi", "agent", "auth.json"), "utf8"),
			);
			const names = Object.keys(auth || {}).filter((k) => auth[k]);
			if (names.length) provider = String(names[0]).slice(0, 24);
		} catch {
			// best-effort — display falls back to "-" below
		}
	}
	if (!provider && (process.env.GONKAAPI_API_KEY || process.env.JOINGONKA_API_KEY)) {
		provider = process.env.JOINGONKA_API_KEY ? "joingonka" : "gonkaapi";
	}
	if (!provider) {
		const hay = String(health.length ? (health[0]?.reason || "") : "");
		if (/gonka/i.test(hay)) provider = "gonkaapi";
	}
	provider = provider || "-";

	// Model: same effective resolution as the provider (config -> PI_* env ->
	// pi settings), then the most recent non-empty model in health.jsonl.
	// Truncated for the tiny display; "-" when unknown.
	let model = String(resolveProviderModel({ config }).model || "").slice(0, 48);
	if (!model) {
		for (let i = 0; i < health.length; i += 1) {
			const m = String(health[i]?.model || "").trim();
			if (m) { model = m.slice(0, 48); break; }
		}
	}
	model = model || "-";

	// GAUGE: success / total over the last 10 LLM calls (health.jsonl is
	// most-recent-first, so head it). `total` is capped at 10 and the ESP32
	// renders the gauge directly from these values.
	const win = health.slice(0, 10);
	let succ = 0;
	for (const h of win) if (h.ok) succ += 1;
	const total = win.length;

	// Persona: active persona first (a started run means that persona is live),
	// otherwise the last run's persona.
	let persona = String(lastRun?.persona || "");
	if (lastRun && (lastRun.status === "started" || lastRun.status === "running")) {
		persona = String(lastRun.persona || persona);
	}
	persona = (persona || "-").slice(0, 24);

	// Traffic-light logic (binary per v3 UI: GREEN = loop doing work, else RED).
	// Green requires loop on, no stop requested, last run not an error, and
	// either a persona actively running (work in progress — long sessions are
	// normal) or fresh finished activity (<=15 min). A present stop file
	// (/loop-stop) means the loop is stopped/stopping, so force RED (and
	// report loop:false) even while the old PID still holds the lock until
	// its current cycle exits.
	const activeP = Boolean(
		lastRun && (lastRun.status === "started" || lastRun.status === "running"),
	);
	let status = "red";
	const lastFailed = lastRun && (lastRun.status === "error" || lastRun.action === "error");
	const stopped = Boolean(loop.stopFilePresent);
	const effectiveRunning = Boolean(loop.running && !stopped);
	if (!stopped && loop.running && !lastFailed && (activeP || (ago_s >= 0 && ago_s <= 900))) {
		status = "green";
	}
	return {
		ok: true,
		proj: String(active.projectName || "").slice(0, 24),
		loop: effectiveRunning,
		status,
		provider,
		model,
		succ,
		total,
		persona,
		ago_s,
		last,
		ok_n,
		fail_n,
		tok_today,
		err: errors.length,
		at: new Date().toISOString(),
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
