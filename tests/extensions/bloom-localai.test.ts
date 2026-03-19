import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";

let api: MockExtensionAPI;

beforeEach(async () => {
	vi.resetModules();
	api = createMockExtensionAPI();
	const mod = await import("../../core/pi-extensions/bloom-localai/index.js");
	mod.default(api as never);
});

describe("bloom-localai registration", () => {
	it("calls registerProvider with localai", () => {
		expect(api.registerProvider).toHaveBeenCalledOnce();
		expect(api.registerProvider).toHaveBeenCalledWith(
			"localai",
			expect.objectContaining({
				baseUrl: "http://localhost:11435/v1",
				api: "openai-completions",
			}),
		);
	});

	it("registers the seeded Qwen model", () => {
		const [, config] = (api.registerProvider as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0];
		const model = config.models[0];
		expect(model.id).toBe("Qwen3.5-4B-Q4_K_M");
		expect(model.name).toBe("Qwen 3.5 4B");
		expect(model.reasoning).toBe(false);
		expect(model.input).toEqual(["text"]);
		expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	it("registers no tools and no event handlers", () => {
		expect(api._registeredTools).toHaveLength(0);
		expect(api._eventHandlers.size).toBe(0);
	});
});
