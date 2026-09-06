/**
 * Shared provider-definition factory (Phase A3).
 *
 * `gonkaapi.ts` and `joingonka.ts` were ~80% duplicated boilerplate (OpenAI
 * completions shape, `reasoning` + `reasoning_effort: "max"`, per-1M-token
 * costs). Provider files are now thin declarations over these helpers, so a
 * change to the shared shape (e.g. a new capability flag) lands in one place.
 * Costs, context windows, and token caps stay per-model literals — they are
 * provider pricing decisions and must remain independently editable.
 *
 * Plain JS on purpose — imported by `extensions/*.ts` (via jiti) and directly
 * by tests / node scripts, matching the seed/loop convention.
 */

/**
 * Build an OpenAI-compatible provider descriptor for `pi.registerProvider`.
 *
 * @param {object} p
 * @param {string} p.name human-readable provider name
 * @param {string} p.baseUrl OpenAI-compatible endpoint base URL
 * @param {string} p.apiKeyEnv env var holding the API key (without `$`)
 * @param {object[]} p.models model descriptors (see {@link reasoningModel})
 * @returns {{ name: string, baseUrl: string, apiKey: string, api: string, models: object[] }}
 */
export function openAiProvider({ name, baseUrl, apiKeyEnv, models }) {
	return {
		name,
		baseUrl,
		apiKey: `$${apiKeyEnv}`,
		api: "openai-completions",
		models,
	};
}

/**
 * Build a reasoning-model descriptor with the harness's standard shape.
 *
 * @param {object} p
 * @param {string} p.id provider-qualified model id
 * @param {string} p.name human-readable model name
 * @param {number} p.contextWindow context window in tokens
 * @param {number} p.maxTokens max output tokens
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number }} p.cost per-1M-token cost
 * @returns {object} model descriptor for `pi.registerProvider`
 */
export function reasoningModel({ id, name, contextWindow, maxTokens, cost }) {
	return {
		id,
		name,
		reasoning: true,
		reasoning_effort: "max",
		input: ["text"],
		cost,
		contextWindow,
		maxTokens,
	};
}
