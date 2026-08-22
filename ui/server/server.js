#!/usr/bin/env node
/**
 * auto-pi UI backend server.
 *
 * A lightweight, dependency-free Node HTTP server that reads the active
 * project's local `.pi/logs/` ledgers (runs.jsonl, events.jsonl, health.jsonl,
 * errors.jsonl, usage.jsonl, summary.jsonl) and exposes them as a JSON API for
 * the Vite + React dashboard.
 *
 *   node ui/server/server.js [--port 8787]
 *
 * Endpoints (all read-only, no auth — intended for local use):
 *   GET /api/status   project identity, loop state, active persona, budget
 *   GET /api/events   structured progress-event timeline
 *   GET /api/runs     persona run records
 *   GET /api/health   LLM-provider health (success rate, failures, retries)
 *   GET /api/usage    token usage per day
 *   GET /api/errors   recent errors
 *   GET /api/summary  latest machine-readable execution summary
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
const PORT = Number(process.env.AUTOPI_UI_PORT) || 8787;

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

		if (path === "/api/healthz") {
			return sendJson(res, 200, { ok: true, service: "auto-pi-ui", time: new Date().toISOString() });
		}

		return sendError(res, 404, `Unknown endpoint: ${path}`);
	} catch (err) {
		return sendError(res, 500, err?.message || String(err));
	}
});

server.listen(PORT, () => {
	process.stdout.write(`auto-pi UI backend listening on http://localhost:${PORT}\n`);
});
