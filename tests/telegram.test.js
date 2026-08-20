/**
 * M11 Telegram notification tests (plan.md §24).
 *
 * Covers: config-driven + env-driven resolution, no-op when disabled or env
 * vars absent, message building for each lifecycle event, sendMessage via a fake
 * fetch, and secret/chat-id redaction.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	telegramOptions,
	resolveCredentials,
	buildMessage,
	sendTelegram,
	notifyEvent,
	redactTelegram,
} from "../skills/telegram-notify/core.js";

/** Baseline config with telegram notifications enabled + default env names. */
const enabledConfig = {
	project: { name: "Acme App", owner: "octocat", repo: "acme-app", demoUrl: "https://octocat.github.io/acme-app/" },
	notifications: { telegram: { enabled: true } },
};

/** Env with both required vars set. */
const baseEnv = {
	TELEGRAM_BOT_TOKEN: "123456789:AAexamplebot_token_value_0000",
	TELEGRAM_CHAT_ID: "987654321",
};

/** Fake fetch that records the request and returns a 200. */
function fakeFetch(ok = true, status = 200) {
	const calls = [];
	const fn = async (url, opts) => {
		calls.push({ url, opts, body: JSON.parse(opts.body) });
		return { ok, status };
	};
	return { fn, calls };
}

// --- telegramOptions ---

test("telegramOptions default to disabled with documented env names", () => {
	const o = telegramOptions({});
	assert.equal(o.enabled, false);
	assert.equal(o.botTokenEnv, "TELEGRAM_BOT_TOKEN");
	assert.equal(o.chatIdEnv, "TELEGRAM_CHAT_ID");
	assert.equal(o.notifyOnDone, true);
	assert.equal(o.notifyOnStopped, true);
	assert.equal(o.notifyOnNeedsHuman, true);
});

test("telegramOptions reads all config fields", () => {
	const o = telegramOptions({
		notifications: {
			telegram: {
				enabled: true,
				botTokenEnv: "MY_BOT",
				chatIdEnv: "MY_CHAT",
				notifyOnDone: false,
				notifyOnStopped: false,
				notifyOnNeedsHuman: false,
			},
		},
	});
	assert.equal(o.enabled, true);
	assert.equal(o.botTokenEnv, "MY_BOT");
	assert.equal(o.chatIdEnv, "MY_CHAT");
	assert.equal(o.notifyOnDone, false);
	assert.equal(o.notifyOnStopped, false);
	assert.equal(o.notifyOnNeedsHuman, false);
});

// --- resolveCredentials ---

test("resolveCredentials fails when disabled (no-env needed)", () => {
	const r = resolveCredentials(telegramOptions({}), baseEnv);
	assert.equal(r.ok, false);
	assert.match(r.reason, /disabled/);
});

test("resolveCredentials fails when bot token env missing", () => {
	const r = resolveCredentials(telegramOptions(enabledConfig), { TELEGRAM_CHAT_ID: "1" });
	assert.equal(r.ok, false);
	assert.match(r.reason, /TELEGRAM_BOT_TOKEN/);
});

test("resolveCredentials fails when chat id env missing", () => {
	const r = resolveCredentials(telegramOptions(enabledConfig), { TELEGRAM_BOT_TOKEN: "t" });
	assert.equal(r.ok, false);
	assert.match(r.reason, /TELEGRAM_CHAT_ID/);
});

test("resolveCredentials succeeds with both env vars", () => {
	const r = resolveCredentials(telegramOptions(enabledConfig), baseEnv);
	assert.equal(r.ok, true);
	assert.equal(r.botToken, baseEnv.TELEGRAM_BOT_TOKEN);
	assert.equal(r.chatId, baseEnv.TELEGRAM_CHAT_ID);
});

// --- buildMessage ---

test("buildMessage done includes project, repo, demo", () => {
	const msg = buildMessage("done", {
		config: enabledConfig,
		completed: { status: "done", demoUrl: "https://example.com/demo" },
	});
	assert.match(msg, /Acme App/);
	assert.match(msg, /octocat\/acme-app/);
	assert.match(msg, /https:\/\/github.com\/octocat\/acme-app/);
	assert.match(msg, /https:\/\/example.com\/demo/);
	assert.match(msg, /Project completed/);
});

test("buildMessage needs-human includes reason + repo", () => {
	const msg = buildMessage("needs-human", { config: enabledConfig, reason: "Pages blocked" });
	assert.match(msg, /Human attention needed/);
	assert.match(msg, /Pages blocked/);
	assert.match(msg, /github.com\/octocat\/acme-app/);
});

test("buildMessage stopped-budget includes reason", () => {
	const msg = buildMessage("stopped-budget", { config: enabledConfig, reason: "token budget exceeded (750000 >= 750000)" });
	assert.match(msg, /budget reached/);
	assert.match(msg, /token budget exceeded/);
});

test("buildMessage stopped-manual mentions clean exit", () => {
	const msg = buildMessage("stopped-manual", { config: enabledConfig });
	assert.match(msg, /stopped manually/);
	assert.match(msg, /exited cleanly/);
});

// --- sendTelegram ---

test("sendTelegram posts to the Bot API and returns sent", async () => {
	const { fn, calls } = fakeFetch();
	const options = telegramOptions(enabledConfig);
	const res = await sendTelegram({ options, env: baseEnv, text: "hello", fetchFn: fn });
	assert.equal(res.ok, true);
	assert.equal(res.sent, true);
	assert.equal(calls.length, 1);
	const call = calls[0];
	assert.match(call.url, /api\.telegram\.org\/bot123456789:AAexamplebot_token_value_0000\/sendMessage/);
	assert.equal(call.body.chat_id, "987654321");
	assert.equal(call.body.text, "hello");
	// The token never appears in the request *body*, only the URL path (Bot API).
});

test("sendTelegram no-ops when disabled or env missing", async () => {
	const { fn } = fakeFetch();
	const off = await sendTelegram({ options: telegramOptions({}), env: baseEnv, text: "hi", fetchFn: fn });
	assert.equal(off.ok, false);
	assert.match(off.reason, /disabled/);
	const missing = await sendTelegram({ options: telegramOptions(enabledConfig), env: {}, text: "hi", fetchFn: fn });
	assert.equal(missing.ok, false);
	assert.match(missing.reason, /TELEGRAM_BOT_TOKEN/);
});

test("sendTelegram returns ok=false on HTTP failure without throwing", async () => {
	const { fn } = fakeFetch(false, 400);
	const res = await sendTelegram({ options: telegramOptions(enabledConfig), env: baseEnv, text: "hi", fetchFn: fn });
	assert.equal(res.ok, false);
	assert.match(res.reason, /400/);
});

test("sendTelegram returns ok=false on fetch throw without throwing", async () => {
	const throws = async () => { throw new Error("network down"); };
	const res = await sendTelegram({ options: telegramOptions(enabledConfig), env: baseEnv, text: "hi", fetchFn: throws });
	assert.equal(res.ok, false);
	assert.match(res.reason, /network down/);
});

// --- notifyEvent (flag gating) ---

test("notifyEvent done respects notifyOnDone=false", async () => {
	const { fn, calls } = fakeFetch();
	const cfg = {
		...enabledConfig,
		notifications: { telegram: { enabled: true, notifyOnDone: false } },
	};
	const res = await notifyEvent({ workspace: "/tmp", config: cfg, event: "done", completed: {}, env: baseEnv, fetchFn: fn });
	assert.equal(res.ok, false);
	assert.match(res.reason, /notifyOnDone disabled/);
	assert.equal(calls.length, 0);
});

test("notifyEvent sends done when enabled and env present", async () => {
	const { fn, calls } = fakeFetch();
	const res = await notifyEvent({
		workspace: "/tmp",
		config: enabledConfig,
		event: "done",
		completed: { status: "done", demoUrl: "https://d/d" },
		env: baseEnv,
		fetchFn: fn,
	});
	assert.equal(res.ok, true);
	assert.equal(calls.length, 1);
	assert.match(calls[0].body.text, /Project completed/);
});

test("notifyEvent needs-human honors flag and sends", async () => {
	const { fn, calls } = fakeFetch();
	const res = await notifyEvent({
		workspace: "/tmp", config: enabledConfig, event: "needs-human", reason: "blocked",
		env: baseEnv, fetchFn: fn,
	});
	assert.equal(res.ok, true);
	assert.equal(calls.length, 1);
	assert.match(calls[0].body.text, /Human attention needed/);
});

test("notifyEvent stopped-budget honors notifyOnStopped", async () => {
	const { fn, calls } = fakeFetch();
	const res = await notifyEvent({
		workspace: "/tmp", config: enabledConfig, event: "stopped-budget", reason: "budget",
		env: baseEnv, fetchFn: fn,
	});
	assert.equal(res.ok, true);
	assert.equal(calls.length, 1);
	assert.match(calls[0].body.text, /budget reached/);
});

// --- redaction ---

test("redactTelegram scrubs bot tokens and chat ids", () => {
	const text = "token 123456789:AAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb secret and chatId 987654321 end";
	const red = redactTelegram(text);
	assert.ok(!/\d{6,12}:[A-Za-z0-9_-]{30,}/.test(red));
	assert.ok(!/987654321/.test(red));
	assert.match(red, /\[TELEGRAM-REDACTED\]/);
	assert.match(red, /chatId\s\[REDACTED\]/);
});

test("redactTelegram leaves normal text intact", () => {
	const text = "project completed acme-app demo https://github.com/octocat/acme-app";
	assert.equal(redactTelegram(text), text);
});

// --- completed.json helper integration (orchestrator observes the marker) ---

test("readCompletedState-style file is detected via notify.js path (marker exists)", async () => {
	// This mirrors what the orchestrator does: read .pi/state/completed.json.
	const dir = await mkdtemp(join(tmpdir(), "auto-pi-tg-"));
	await mkdir(join(dir, ".pi", "state"), { recursive: true });
	await writeFile(
		join(dir, ".pi", "state", "completed.json"),
		JSON.stringify({ status: "done", completedAt: new Date().toISOString(), repo: "o/r", demoUrl: "https://d/d" }),
		"utf8",
	);
	// Re-run the notify path with a done marker and a fake fetch.
	const { fn, calls } = fakeFetch();
	const config = { ...enabledConfig };
	// Read the file exactly as the orchestrator/notify.js would.
	const { readFile } = await import("node:fs/promises");
	const completed = JSON.parse(await readFile(join(dir, ".pi", "state", "completed.json"), "utf8"));
	const res = await notifyEvent({ workspace: dir, config, event: "done", completed, env: baseEnv, fetchFn: fn });
	assert.equal(res.ok, true);
	assert.equal(calls.length, 1);
	// The message uses the config's project repo.
	assert.match(calls[0].body.text, /octocat\/acme-app/);
});
