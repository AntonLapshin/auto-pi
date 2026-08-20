/**
 * Telegram notification core for the auto-pi harness (M11, plan.md §24).
 *
 * Optional, env-driven notifications for key lifecycle events: project done,
 * needs-human, budget/loop stopped. No-ops without crashing when notifications
 * are disabled or the required env vars are absent.
 *
 * Configuration (plan.md §24) lives under `config.notifications.telegram`:
 *
 *   enabled          (default false)        master switch
 *   botTokenEnv      (default TELEGRAM_BOT_TOKEN) env var holding the bot token
 *   chatIdEnv        (default TELEGRAM_CHAT_ID)   env var holding the chat id
 *   notifyOnDone     (default true)  send "project completed"
 *   notifyOnStopped  (default true)  send "loop stopped" (budget or manual)
 *   notifyOnNeedsHuman (default true) send "needs human attention"
 *
 * Secrets rule (plan.md §24 / §7.2): the bot token and chat id are read from
 * environment variables at runtime and are NEVER written to logs, summaries,
 * or message bodies. `redactTelegram()` scrubs token/chat-id-shaped values from
 * any text that reaches the harness logs.
 *
 * Plain JS on purpose — imported via jiti by the `/loop` extension, the
 * `scripts/notify.js` CLI, and directly by tests.
 */

/**
 * Default env-var names for the Telegram bot token and chat id (plan.md §24).
 */
export const DEFAULT_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const DEFAULT_CHAT_ID_ENV = "TELEGRAM_CHAT_ID";

/** Telegram Bot API base URL (sendMessage endpoint). */
const TELEGRAM_API = "https://api.telegram.org";

/**
 * Where activity is logged. Injected so the core stays pure and the loop can
 * route to its own logger. Defaults to writing nothing (no crash, no leak).
 */
let logger = () => {};

/**
 * Set the logger used for non-secret notification activity lines.
 * @param {(line: string) => void} fn
 */
export function setLogger(fn) {
	logger = typeof fn === "function" ? fn : () => {};
}

/**
 * Shape a secret-shaped value for safe logging — never echo the value itself.
 * Used to show *which* env var we looked for without exposing what it holds.
 */
export function safeEnvLabel(name) {
	return `env:${String(name || "").toUpperCase()}`;
}

/**
 * Read the Telegram notification options from a parsed config.
 *
 * @param {object} [config] parsed .pi/config.json
 * @returns {{
 *   enabled: boolean,
 *   botTokenEnv: string,
 *   chatIdEnv: string,
 *   notifyOnDone: boolean,
 *   notifyOnStopped: boolean,
 *   notifyOnNeedsHuman: boolean,
 * }}
 */
export function telegramOptions(config = {}) {
	const t = config?.notifications?.telegram || {};
	const bool = (v, def) => (v === undefined ? def : Boolean(v));
	return {
		enabled: bool(t.enabled, false),
		botTokenEnv: t.botTokenEnv || DEFAULT_BOT_TOKEN_ENV,
		chatIdEnv: t.chatIdEnv || DEFAULT_CHAT_ID_ENV,
		notifyOnDone: bool(t.notifyOnDone, true),
		notifyOnStopped: bool(t.notifyOnStopped, true),
		notifyOnNeedsHuman: bool(t.notifyOnNeedsHuman, true),
	};
}

/**
 * Resolve the live bot token + chat id from the process environment.
 *
 * @param {object} options  from telegramOptions()
 * @param {object} [env]    environment override (defaults to process.env)
 * @returns {{ ok: boolean, botToken?: string, chatId?: string, reason?: string }}
 */
export function resolveCredentials(options, env = process.env) {
	if (!options.enabled) return { ok: false, reason: "telegram notifications disabled" };
	const botToken = env?.[options.botTokenEnv];
	const chatId = env?.[options.chatIdEnv];
	if (!botToken) return { ok: false, reason: `missing ${safeEnvLabel(options.botTokenEnv)}` };
	if (!chatId) return { ok: false, reason: `missing ${safeEnvLabel(options.chatIdEnv)}` };
	return { ok: true, botToken, chatId };
}

/**
 * Redact Telegram bot-token and chat-id shaped values from a string so harness
 * logs never leak them. Bot tokens are `digits:alphanumerics`; chat ids are
 * typically long numeric (possibly negative, possibly with @ for public chats).
 *
 * @param {string} text
 * @returns {string} redacted text
 */
export function redactTelegram(text) {
	if (typeof text !== "string" || text.length === 0) return text;
	return text
		// Bot tokens: `123456789:AA...`
		.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[TELEGRAM-REDACTED]")
		// Numeric chat ids / ids preceded by `@` (public handles).
		// Matches `chat_id`/`chatId`/`chat-id` followed by `=`/`:`/space and a
		// 5+ digit value, or a bare 9+ digit id.
		.replace(/(chat[_-]?id\b[\s:=]*)(-?\d{5,})/gi, "$1[REDACTED]")
		.replace(/\b@[A-Za-z0-9_]{3,}\b/g, (m) => /^(chat|bot)/i.test(m) ? "[REDACTED]" : m);
}

/**
 * Send a plain-text message to the configured Telegram chat via the Bot API.
 *
 * @param {object} p
 * @param {object} p.options    telegramOptions()
 * @param {object} [p.env]      environment override (defaults to process.env)
 * @param {string} p.text       message body (secrets must be pre-redacted)
 * @param {Function} [p.fetchFn] fetch implementation override (for tests)
 * @returns {Promise<{ ok: boolean, sent?: boolean, reason?: string }>}
 */
export async function sendTelegram({ options, env = process.env, text, fetchFn }) {
	const creds = resolveCredentials(options, env);
	if (!creds.ok) {
		logger(`[notify] skipped: ${creds.reason}`);
		return { ok: false, reason: creds.reason };
	}
	if (!text || !String(text).trim()) {
		return { ok: false, reason: "empty message" };
	}

	const doFetch = fetchFn || globalThis.fetch?.bind(globalThis);
	if (typeof doFetch !== "function") {
		logger(`[notify] skipped: no fetch available`);
		return { ok: false, reason: "no fetch available" };
	}

	const url = `${TELEGRAM_API}/bot${creds.botToken}/sendMessage`;
	const payload = { chat_id: creds.chatId, text: String(text), disable_web_page_preview: true };

	try {
		const res = await doFetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		const ok = res.ok || res.status === 200;
		logger(`[notify] sendMessage → HTTP ${res.status} (${ok ? "sent" : "failed"})`);
		// Never log the response body — it can echo the chat id / token.
		return { ok, sent: ok, reason: ok ? undefined : `sendMessage failed (HTTP ${res.status})` };
	} catch (err) {
		logger(`[notify] sendMessage error: ${redactTelegram(String(err?.message || err))}`);
		return { ok: false, reason: `sendMessage error: ${redactTelegram(String(err?.message || err))}` };
	}
}

/**
 * Build the human-readable message for a lifecycle event. Kept small and
 * secret-free (no tokens, no chat id).
 *
 * @param {string} event "done" | "needs-human" | "stopped-budget" | "stopped-manual"
 * @param {object} p
 * @param {object} p.config      parsed config (project name, repo, demo URL)
 * @param {string} [p.reason]    extra detail (needs-human reason / stop reason)
 * @param {object} [p.completed] parsed completed.json for the done event
 * @returns {string} markdown message text
 */
export function buildMessage(event, { config = {}, reason = "", completed } = {}) {
	const project = config?.project || {};
	const name = project?.name || "";
	const repo = project?.owner && project?.repo ? `${project.owner}/${project.repo}` : (project?.repo || "");
	const repoUrl = repo ? `https://github.com/${repo}` : "";
	const demo = completed?.demoUrl || project?.demoUrl || "";

	const lines = [`*auto-pi — ${name || repo || "project"}*`];
	lines.push(``);

	switch (event) {
		case "done": {
			lines.push(`✅ *Project completed*`);
			lines.push(``);
			lines.push(`All milestones are done and the demo is deployed.`);
			if (repoUrl) lines.push(`• Repo: ${repoUrl}`);
			if (demo) lines.push(`• Demo: ${demo}`);
			break;
		}
		case "needs-human": {
			lines.push(`⚠️ *Human attention needed*`);
			lines.push(``);
			lines.push(reason ? `Reason: ${reason}` : `A human decision is required to continue.`);
			if (repoUrl) lines.push(`• Repo: ${repoUrl}`);
			break;
		}
		case "stopped-budget": {
			lines.push(`🛑 *Loop stopped — budget reached*`);
			lines.push(``);
			lines.push(reason ? reason : `The daily token/cost budget was exceeded.`);
			if (repoUrl) lines.push(`• Repo: ${repoUrl}`);
			break;
		}
		case "stopped-manual": {
			lines.push(`🛑 *Loop stopped manually*`);
			lines.push(``);
			lines.push(`The stop file was detected; the loop exited cleanly.`);
			if (repoUrl) lines.push(`• Repo: ${repoUrl}`);
			break;
		}
		default:
			lines.push(reason || event);
	}
	lines.push(``);
	lines.push(`_Sent by auto-pi harness._`);
	return lines.join("\n");
}

/**
 * Send a notification for a lifecycle event, honoring the config flags.
 * Guaranteed not to throw and not to fail the caller — returns a result object
 * instead. When disabled or env vars are absent, it is a silent no-op.
 *
 * @param {object} p
 * @param {string} p.workspace   (unused by the core; kept for API symmetry)
 * @param {object} p.config      parsed config
 * @param {string} p.event       "done" | "needs-human" | "stopped-budget" | "stopped-manual"
 * @param {string} [p.reason]
 * @param {object} [p.completed] parsed completed.json
 * @param {object} [p.env]       env override
 * @param {Function} [p.fetchFn] fetch override for tests
 * @returns {Promise<{ ok: boolean, sent?: boolean, reason?: string }>}
 */
export async function notifyEvent({ workspace, config = {}, event, reason = "", completed, env, fetchFn }) {
	if (!event) return { ok: false, reason: "no event" };
	const options = telegramOptions(config);

	// Flag gate: only send when the individual event is opted in.
	const flag = {
		done: options.notifyOnDone,
		"needs-human": options.notifyOnNeedsHuman,
		"stopped-budget": options.notifyOnStopped,
		"stopped-manual": options.notifyOnStopped,
	}[event];
	if (!flag) {
		logger(`[notify] skipped: notifyOn${camel(event)} disabled`);
		return { ok: false, reason: `notifyOn${camel(event)} disabled` };
	}

	const text = buildMessage(event, { config, reason, completed });
	return sendTelegram({ options, env, text, fetchFn });
}

/** "done" → "Done"; "needs-human" → "NeedsHuman"; "stopped-budget" → "StoppedBudget". */
function camel(event) {
	return String(event || "")
		.split("-")
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
}
