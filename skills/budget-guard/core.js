/**
 * Budget guard core for the auto-pi harness (M13, plan.md §21).
 *
 * Centralises the token/cost budget limits and the per-persona context/output
 * caps. The loop calls `checkBudget` every cycle (via the state scanner) and
 * `checkCycleBudget` before launching a persona so runaway spend stops the
 * loop gracefully with a clear reason.
 *
 * Plain JS on purpose — imported via jiti by the extensions and directly by
 * tests / node scripts.
 */

/** Default per-cycle token budget (config.limits.maxTokensPerCycle). 0 = unlimited. */
export const DEFAULT_MAX_TOKENS_PER_CYCLE = 0;

/** Default per-day token budget (config.limits.maxTokensPerDay). 0 = unlimited. */
export const DEFAULT_MAX_TOKENS_PER_DAY = 0;

/** Default per-day cost budget in USD (config.limits.maxCostPerDayUsd). 0 = unlimited. */
export const DEFAULT_MAX_COST_PER_DAY_USD = 0;

/** Default model context window (config.pi.contextMaxTokens). 0 = unlimited. */
export const DEFAULT_CONTEXT_MAX_TOKENS = 0;

/** Default max prompt tokens per persona (config.limits.maxPromptTokensPerPersona). 0 = unlimited. */
export const DEFAULT_MAX_PROMPT_TOKENS_PER_PERSONA = 0;

/** Default max output tokens per persona (config.limits.maxOutputTokensPerPersona). 0 = unlimited. */
export const DEFAULT_MAX_OUTPUT_TOKENS_PER_PERSONA = 0;

/** Default consecutive-failure limit (config.loop.maxConsecutiveFailures). */
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Read the budget limits from a parsed config, applying defaults.
 *
 * @param {object} [config] parsed .pi/config.json
 * @returns {{
 *   maxTokensPerCycle: number,
 *   maxTokensPerDay: number,
 *   maxCostPerDayUsd: number,
 *   contextMaxTokens: number,
 *   maxPromptTokensPerPersona: number,
 *   maxOutputTokensPerPersona: number,
 *   maxConsecutiveFailures: number,
 * }}
 */
export function budgetLimits(config = {}) {
	const limits = config?.limits || {};
	const loop = config?.loop || {};
	const pi = config?.pi || {};
	// `0` is a valid, explicit value meaning "unlimited / no cap" for the
	// token/context limits. Absent or non-numeric values fall back to the
	// defaults (which themselves are now 0 = unlimited by default).
	const num = (v, def, { allowZero = false } = {}) => {
		const n = Number(v);
		if (Number.isFinite(n) && (allowZero ? n >= 0 : n > 0)) return n;
		return def;
	};
	return {
		maxTokensPerCycle: num(limits.maxTokensPerCycle, DEFAULT_MAX_TOKENS_PER_CYCLE, { allowZero: true }),
		maxTokensPerDay: num(limits.maxTokensPerDay, DEFAULT_MAX_TOKENS_PER_DAY, { allowZero: true }),
		maxCostPerDayUsd: num(limits.maxCostPerDayUsd, DEFAULT_MAX_COST_PER_DAY_USD, { allowZero: true }),
		contextMaxTokens: num(pi.contextMaxTokens, DEFAULT_CONTEXT_MAX_TOKENS, { allowZero: true }),
		maxPromptTokensPerPersona: num(limits.maxPromptTokensPerPersona, DEFAULT_MAX_PROMPT_TOKENS_PER_PERSONA, { allowZero: true }),
		maxOutputTokensPerPersona: num(limits.maxOutputTokensPerPersona, DEFAULT_MAX_OUTPUT_TOKENS_PER_PERSONA, { allowZero: true }),
		maxConsecutiveFailures: num(loop.maxConsecutiveFailures, DEFAULT_MAX_CONSECUTIVE_FAILURES),
	};
}

/**
 * Evaluate whether the per-day token/cost budget has been exceeded.
 * Pure function: given the parsed config and a usage summary
 * `{ tokensUsed, costUsd, runs }`, returns `{ exceeded, reason }`.
 *
 * @param {object} [config] parsed .pi/config.json
 * @param {object} [usage]  { tokensUsed, costUsd, runs }
 * @returns {{ exceeded: boolean, reason?: string }}
 */
export function checkBudget(config = {}, usage = {}) {
	const limits = budgetLimits(config);
	const tokensUsed = Number(usage.tokensUsed) || 0;
	const costUsd = Number(usage.costUsd) || 0;

	// A maxTokensPerDay of 0 means the per-day token cap is disabled (unlimited).
	if (limits.maxTokensPerDay > 0 && tokensUsed >= limits.maxTokensPerDay) {
		return {
			exceeded: true,
			reason: `token budget exceeded (${tokensUsed} >= ${limits.maxTokensPerDay} tokens/day)`,
		};
	}
	if (limits.maxCostPerDayUsd > 0 && costUsd >= limits.maxCostPerDayUsd) {
		return {
			exceeded: true,
			reason: `cost budget exceeded ($${costUsd.toFixed(2)} >= $${limits.maxCostPerDayUsd}/day)`,
		};
	}
	return { exceeded: false };
}

/**
 * Evaluate whether the per-cycle token budget has been exceeded.
 *
 * @param {object} [config] parsed .pi/config.json
 * @param {number} [cycleTokens] tokens consumed in the current cycle
 * @returns {{ exceeded: boolean, reason?: string }}
 */
export function checkCycleBudget(config = {}, cycleTokens = 0) {
	const limits = budgetLimits(config);
	const tokens = Number(cycleTokens) || 0;
	// A maxTokensPerCycle of 0 means the per-cycle cap is disabled (unlimited).
	if (limits.maxTokensPerCycle > 0 && tokens >= limits.maxTokensPerCycle) {
		return {
			exceeded: true,
			reason: `cycle token budget exceeded (${tokens} >= ${limits.maxTokensPerCycle} tokens/cycle)`,
		};
	}
	return { exceeded: false };
}

/**
 * Evaluate whether a consecutive-failure count has reached the configured limit.
 *
 * @param {object} [config] parsed .pi/config.json
 * @param {number} [consecutiveFailures] count of consecutive failed cycles
 * @returns {{ exceeded: boolean, reason?: string }}
 */
export function checkConsecutiveFailures(config = {}, consecutiveFailures = 0) {
	const limit = budgetLimits(config).maxConsecutiveFailures;
	const n = Number(consecutiveFailures) || 0;
	if (n >= limit) {
		return {
			exceeded: true,
			reason: `repeated failures (${n} consecutive >= limit ${limit}) — stopping loop`,
		};
	}
	return { exceeded: false };
}

/**
 * Build the `pi` CLI token-cap flags for a persona run, enforcing the
 * per-persona context/output caps (plan.md §21 / M13).
 *
 * @param {object} [config] parsed .pi/config.json
 * @returns {string[]} extra CLI args (e.g. ["--max-context", "150000", ...])
 */
export function personaTokenFlags(config = {}) {
	const limits = budgetLimits(config);
	const args = [];
	if (limits.contextMaxTokens > 0) args.push("--max-context", String(limits.contextMaxTokens));
	if (limits.maxPromptTokensPerPersona > 0) args.push("--max-prompt", String(limits.maxPromptTokensPerPersona));
	if (limits.maxOutputTokensPerPersona > 0) args.push("--max-output", String(limits.maxOutputTokensPerPersona));
	return args;
}
