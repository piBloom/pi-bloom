import { describe, expect, it } from "vitest";

describe("bridge catalog", () => {
	it("loads bridge entries from catalog.yaml", async () => {
		const { loadBridgeCatalog } = await import("../../lib/services-catalog.js");
		const bridges = loadBridgeCatalog(process.cwd());
		expect(bridges).toHaveProperty("whatsapp");
		expect(bridges).toHaveProperty("telegram");
		expect(bridges).toHaveProperty("signal");
		expect(bridges.whatsapp.image).toContain("mautrix/whatsapp");
		expect(bridges.whatsapp.health_port).toBe(29318);
	});
});
