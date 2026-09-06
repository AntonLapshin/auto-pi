/**
 * gonkaapi provider for pi.
 *
 * Registers the "gonkaapi" provider (GonkaAPI) as an OpenAI-compatible
 * endpoint, mirroring the opencode configuration, and exposes the
 * DeepSeek V4 Flash 0731 model.
 *
 * Usage:
 *   export GONKAAPI_API_KEY=...
 *   pi --provider gonkaapi --model deepseek-ai/DeepSeek-V4-Flash-0731 "hello"
 *
 * Or select the model interactively with /model.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openAiProvider, reasoningModel } from "./providers.js";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("gonkaapi", openAiProvider({
		name: "GonkaAPI",
		baseUrl: "https://hskyauefqcgbvgvxkluj.supabase.co/functions/v1/gonka",
		apiKeyEnv: "GONKAAPI_API_KEY",
		models: [
			reasoningModel({
				id: "deepseek-ai/DeepSeek-V4-Flash-0731",
				name: "DeepSeek V4 Flash 0731",
				cost: { input: 0.07, output: 0.1, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 32768,
			}),
		],
	}));
}
