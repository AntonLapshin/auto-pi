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

/** Default per-cycle token budget (config.limits.maxTokensPerCycle). */
export const DEFAULT_MAX_TOKENS_PER_CYCLE = 250000;

/** Default per-day token budget (config.limits.maxTokensPerDay). */
export const DEFAULT_MAX_TOKENS_PER_DAY = 750000;

/** Default per-day cost budget in USD (config.limits.maxCostPerDayUsd). */
export const DEFAULT_MAX_COST_PER_DAY_USD = 20;

/** Default model context window (config.pi.contextMaxTokens). */
export const DEFAULT_CONTEXT_MAX_TOKENS = 150000;

/** Default max prompt tokens per persona (config.limits.maxPromptTokensPerPersona). */
export const DEFAULT_MAX_PROMPT_TOKENS_PER_PERSONA = 135000;

/** Default max output tokens per persona (config.limits.maxOutputTokensPerPersona). */
export const DEFAULT_MAX_OUTPUT_TOKENS_PER_PERSONA = 8000;

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
	const num = (v, def) => {
		const n = Number(v);
		return Number.isFinite(n) && n > 0 ? n : def;
	};
	return {
		maxTokensPerCycle: num(limits.maxTokensPerCycle, DEFAULT_MAX_TOKENS_PER_CYCLE),
		maxTokensPerDay: num(limits.maxTokensPerDay, DEFAULT_MAX_TOKENS_PER_DAY),
		maxCostPerDayUsd: num(limits.maxCostPerDayUsd, DEFAULT_MAX_COST_PER_DAY_USD),
		contextMaxTokens: num(pi.contextMaxTokens, DEFAULT_CONTEXT_MAX_TOKENS),
		maxPromptTokensPerPersona: num(limits.maxPromptTokensPerPersona, DEFAULT_MAX_PROMPT_TOKENS_PER_PERSONA),
		maxOutputTokensPerPersona: num(limits.maxOutputTokensPerPersona, DEFAULT_MAX_OUTPUT_TOKENS_PER_PERSONA),
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

	if (tokensUsed >= limits.maxTokensPerDay) {
		return {
			exceeded: true,
			reason: `token budget exceeded (${tokensUsed} >= ${limits.maxTokensPerDay} tokens/day)`,
		};
	}
	if (costUsd >= limits.maxCostPerDayUsd) {
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
	if (tokens >= limits.maxTokensPerCycle) {
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
