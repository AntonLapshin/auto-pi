/**
 * joingonka provider for pi.
 *
 * Registers the "joingonka" provider (JoinGonka / Gonka) as an OpenAI-compatible
 * endpoint, mirroring the opencode configuration, and exposes the
 * DeepSeek V4 Flash 0731 model.
 *
 * Usage:
 *   export JOINGONKA_API_KEY=...
 *   pi --provider joingonka --model deepseek-ai/DeepSeek-V4-Flash-0731 "hello"
 *
 * Or select the model interactively with /model.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("joingonka", {
		name: "JoinGonka (Gonka)",
		baseUrl: "https://gate.joingonka.ai/v1",
		apiKey: "$JOINGONKA_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: "deepseek-ai/DeepSeek-V4-Flash-0731",
				name: "DeepSeek V4 Flash 0731",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
	});
}
