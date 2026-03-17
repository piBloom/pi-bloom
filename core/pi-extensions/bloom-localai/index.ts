/**
 * bloom-localai — Register LocalAI as a Pi provider for local LLM inference.
 *
 * llama-server runs on every Bloom OS instance at http://localhost:11435/v1.
 * The omnicoder-9b-q4_k_m model is pre-seeded and available at boot.
 *
 * @see {@link ../../AGENTS.md#bloom-localai} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("localai", {
		baseUrl: "http://localhost:11435/v1",
		api: "openai-completions",
		models: [
			{
				id: "omnicoder-9b-q4_k_m",
				name: "OmniCoder 9B",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8192,
				maxTokens: 4096,
				compat: {
					supportsDeveloperRole: false,
					maxTokensField: "max_tokens",
				},
			},
		],
	});
}
