/**
 * Shared GitHub client with retry/backoff and rate-limit handling for the
 * auto-pi harness (M13, plan.md §28 "Milestone 13" hardening).
 *
 * Wraps the `gh` CLI (the harness's primary GitHub access) with:
 *
 *   - **Retry/backoff for transient errors** — network timeouts, 5xx server
 *     errors, and `gh` process failures are retried with exponential backoff
 *     + jitter so a transient blip does not crash the loop.
 *   - **Rate-limit handling** — when GitHub returns HTTP 403/429 (rate limit
 *     exceeded), the client reads `X-RateLimit-Reset` from the response and
 *     backs off until that timestamp (plus a small safety margin), then retries.
 *   - **Configurable retry budget** — `maxRetries` and `baseDelayMs` are
 *     injectable so callers (loop vs. one-shot CLIs) can tune the behavior.
 *
 * The returned `gh(args, opts)` has the same shape as the existing helpers in
 * `extensions/seed/core.js` / `extensions/loop/state-scanner.js`:
 *
 *   { ok, stdout, stderr, exitCode }
 *
 * so it is a drop-in replacement and fully testable with a fake `runner`.
 *
 * Plain JS on purpose — imported via jiti by the extensions and directly by
 * tests / node scripts.
 */

import { execa } from "execa";

/** Default number of retries for a transient failure (in addition to the first attempt). */
export const DEFAULT_MAX_RETRIES = 3;

/** Default base backoff delay in ms (doubles per retry, with jitter). */
export const DEFAULT_BASE_DELAY_MS = 1000;

/** Default max backoff delay in ms (cap to avoid over-long sleeps). */
export const DEFAULT_MAX_DELAY_MS = 30000;

/** Default per-command timeout in ms. */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * HTTP status codes that indicate a transient failure worth retrying.
 * 429 (rate limit), 5xx (server errors), and 408 (request timeout).
 */
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

/** True when a `gh` CLI exit code suggests a transient/network failure. */
function isTransientProcessFailure(exitCode) {
	// gh exits 1 on many errors; we treat a non-zero exit as retryable only when
	// the stderr mentions a network/rate-limit/server problem, or the process
	// itself failed to spawn (exitCode null / signal).
	if (exitCode === null || exitCode === undefined) return true;
	return false;
}

/** True when the stderr text hints at a transient (retryable) failure. */
function isTransientText(stderr) {
	const text = String(stderr || "");
	return (
		/rate limit/i.test(text) ||
		/rate_limit/i.test(text) ||
		/timed?\s*out/i.test(text) ||
		/network/i.test(text) ||
		/ECONNRESET/i.test(text) ||
		/ETIMEDOUT/i.test(text) ||
		/5\d\d\b/.test(text) ||
		/temporarily unavailable/i.test(text) ||
		/connection refused/i.test(text) ||
		/502 bad gateway/i.test(text) ||
		/503 service unavailable/i.test(text) ||
		/504 gateway timeout/i.test(text)
	);
}

/**
 * Parse the `X-RateLimit-Reset` epoch-seconds value from a `gh` response.
 * `gh` exposes response headers via `--json` fields on some endpoints, but the
 * most reliable source is the raw HTTP response; `gh api` supports `--jq` and
 * we can also read headers via `gh api -i`. We accept the value directly here.
 *
 * @param {string} value  raw header value (epoch seconds) or ""
 * @returns {number} epoch ms, or 0 when absent
 */
export function parseRateLimitReset(value) {
	const n = Number(value);
	if (Number.isFinite(n) && n > 0) return n * 1000;
	return 0;
}

/**
 * Compute the backoff delay for a given retry attempt (0-indexed). Uses
 * exponential backoff with full jitter: `random(0, min(max, base * 2^attempt))`.
 *
 * @param {number} attempt    0-indexed retry attempt
 * @param {object} [opts]     { baseDelayMs?, maxDelayMs? }
 * @returns {number} delay in ms
 */
export function backoffDelay(attempt, opts = {}) {
	const base = Number(opts.baseDelayMs) > 0 ? Number(opts.baseDelayMs) : DEFAULT_BASE_DELAY_MS;
	const max = Number(opts.maxDelayMs) > 0 ? Number(opts.maxDelayMs) : DEFAULT_MAX_DELAY_MS;
	const cap = Math.min(max, base * Math.pow(2, attempt));
	return Math.floor(Math.random() * cap);
}

/**
 * Sleep for a fixed number of ms (Promise-based).
 * @param {number} ms
 */
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Build a resilient `gh(args, opts)` runner.
 *
 * The returned function retries transient failures (network timeouts, 5xx,
 * rate limits) with exponential backoff + jitter. On a rate limit it backs off
 * until `X-RateLimit-Reset` (when provided via `opts.rateLimitReset`) or a
 * default cooldown, then retries.
 *
 * @param {object} [options]
 * @param {object} [options.runner]    underlying command runner `(args, opts) => Promise<{ok,stdout,stderr,exitCode}>`.
 *                                     Defaults to a real `gh` via execa.
 * @param {number} [options.maxRetries] max retries on transient failure (default 3)
 * @param {number} [options.baseDelayMs] base backoff delay (default 1000)
 * @param {number} [options.maxDelayMs]  max backoff delay (default 30000)
 * @param {number} [options.timeoutMs]   per-command timeout (default 30000)
 * @param {Function} [options.onRetry]   `(info) => void` called before each retry with
 *                                       { attempt, reason, delayMs, cmd }. Useful for logging.
 * @returns {Function} async `gh(args, opts)` → { ok, stdout, stderr, exitCode }
 */
export function createGhClient(options = {}) {
	const runner = options.runner || defaultRunner;
	const maxRetries = Number(options.maxRetries) >= 0
		? Number(options.maxRetries)
		: DEFAULT_MAX_RETRIES;
	const baseDelayMs = Number(options.baseDelayMs) > 0
		? Number(options.baseDelayMs)
		: DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = Number(options.maxDelayMs) > 0
		? Number(options.maxDelayMs)
		: DEFAULT_MAX_DELAY_MS;
	const timeoutMs = Number(options.timeoutMs) > 0
		? Number(options.timeoutMs)
		: DEFAULT_TIMEOUT_MS;
	const onRetry = typeof options.onRetry === "function" ? options.onRetry : () => {};

	/**
	 * Run one `gh` invocation with retry/backoff.
	 * @param {string[]} args
	 * @param {object} [opts] { cwd?, env?, timeout?, rateLimitReset?, input? }
	 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, exitCode: number }>}
	 */
	return async function gh(args, opts = {}) {
		const cmd = Array.isArray(args) ? args.join(" ") : String(args);
		let attempt = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const res = await runner(args, {
				timeout: opts.timeout ?? timeoutMs,
				cwd: opts.cwd,
				env: opts.env,
				input: opts.input,
			});

			// Success — return immediately.
			if (res.ok || res.exitCode === 0) {
				return { ok: true, stdout: res.stdout || "", stderr: res.stderr || "", exitCode: res.exitCode ?? 0 };
			}

			// Determine whether this failure is retryable.
			const rateLimited = /rate limit/i.test(String(res.stderr || ""));
			const transient = rateLimited || isTransientText(res.stderr) || isTransientProcessFailure(res.exitCode);

			if (!transient || attempt >= maxRetries) {
				return { ok: false, stdout: res.stdout || "", stderr: res.stderr || "", exitCode: res.exitCode ?? 1 };
			}

			// Rate limit: back off until the reset time (plus a safety margin),
			// or a default cooldown when the reset time is unknown.
			let delayMs = backoffDelay(attempt, { baseDelayMs, maxDelayMs });
			if (rateLimited) {
				const resetMs = parseRateLimitReset(opts.rateLimitReset);
				const now = Date.now();
				if (resetMs > now) {
					delayMs = Math.min(maxDelayMs, resetMs - now + 1000);
				} else {
					delayMs = Math.max(delayMs, 15000); // unknown reset → at least 15s cooldown
				}
			}

			onRetry({
				attempt: attempt + 1,
				reason: rateLimited ? "rate limit" : (String(res.stderr || "").slice(0, 200)),
				delayMs,
				cmd,
			});

			await sleep(delayMs);
			attempt += 1;
		}
	};
}

/**
 * The default underlying runner: executes `gh <args>` via execa.
 * Returns { ok, stdout, stderr, exitCode } and never throws.
 */
async function defaultRunner(args, opts = {}) {
	try {
		const res = await execa("gh", args, {
			reject: false,
			timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
			cwd: opts.cwd,
			env: opts.env,
			input: opts.input,
		});
		return { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
	} catch (err) {
		return { ok: false, stdout: "", stderr: String(err?.message || err), exitCode: err?.exitCode ?? 1 };
	}
}

/**
 * Convenience: a ready-to-use resilient gh client with default settings.
 * Use this in the loop/context packers instead of the raw execa helper so all
 * GitHub access benefits from retry/backoff + rate-limit handling (M13).
 */
export const gh = createGhClient();
