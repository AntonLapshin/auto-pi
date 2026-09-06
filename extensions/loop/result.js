/**
 * Shared result-shape, exit-code, and best-effort warning helpers (Phase A).
 *
 * Conventions (see REFACTOR_PLAN.md Phase A2):
 *
 *   - Core functions return `{ ok: true, message, ...extra }` on success and
 *     `{ ok: false, message, ...extra }` on failure. Use {@link okResult} /
 *     {@link failResult} so the shape stays uniform across
 *     `orchestrator / seed / pull / status / github-skill` call sites.
 *   - CLI exit codes: `0` ok · `1` operational failure · `2` usage/config
 *     error. See {@link EXIT_CODES}.
 *   - Best-effort side effects (log rotation, lock release, telegram notify,
 *     ledger appends) must never fail silently: use {@link warnSuppressed} so
 *     the suppression is visible on stderr. Call sites that own a workspace
 *     should additionally best-effort append to `errors.jsonl` via
 *     `skills/logging/core.js appendErrorRecord`.
 *
 * Plain JS on purpose — imported by `extensions/*`, `scripts/*`, and tests
 * under plain `node` (no TS transpile), matching the seed/loop convention.
 */

/** CLI exit code: success. */
export const EXIT_OK = 0;

/** CLI exit code: operational failure (network, gh, loop, validation at runtime). */
export const EXIT_OPERATIONAL = 1;

/** CLI exit code: usage error (bad flags/args) or config error (fails fast). */
export const EXIT_USAGE = 2;

/** Named CLI exit codes: `0` ok · `1` operational failure · `2` usage/config error. */
export const EXIT_CODES = {
	OK: EXIT_OK,
	OPERATIONAL: EXIT_OPERATIONAL,
	USAGE: EXIT_USAGE,
};

/**
 * Build a success result.
 * @param {string} message human-readable message
 * @param {object} [extra] additional fields (workspace, repo, pid, ...)
 * @returns {{ ok: true, message: string }}
 */
export function okResult(message, extra = {}) {
	return { ok: true, message, ...extra };
}

/**
 * Build a failure result.
 * @param {string} message human-readable message
 * @param {object} [extra] additional fields (timedOut, error, ...)
 * @returns {{ ok: false, message: string }}
 */
export function failResult(message, extra = {}) {
	return { ok: false, message, ...extra };
}

/**
 * Make a suppressed best-effort failure visible.
 *
 * Replaces silent `.catch(() => {})` handlers: writes a one-line warning to
 * stderr (never throws, never writes secrets — callers pass `err.message`,
 * never raw payloads). When the caller owns a workspace it should also
 * best-effort `appendErrorRecord(workspace, { error, action }, config)`.
 *
 * @param {string} context short label of the best-effort operation (e.g. "loop.lock-release")
 * @param {unknown} err the suppressed error
 */
export function warnSuppressed(context, err) {
	try {
		const detail = err?.message || String(err || "unknown error");
		process.stderr.write(`[auto-pi] warning (${context}): ${detail}\n`);
	} catch {
		// warning delivery itself is best-effort
	}
}
