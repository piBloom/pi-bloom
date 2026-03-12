import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/netbird.js", () => ({
	loadNetBirdToken: vi.fn(),
	getLocalMeshIp: vi.fn(),
	ensureBloomZone: vi.fn(),
	ensureServiceRecord: vi.fn(),
}));

import { ensureBloomZone, ensureServiceRecord, getLocalMeshIp, loadNetBirdToken } from "../../lib/netbird.js";
import { ensureServiceRouting } from "../../lib/service-routing.js";

describe("ensureServiceRouting", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects invalid service names", async () => {
		const result = await ensureServiceRouting("INVALID NAME!");
		expect(result.ok).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("skips DNS when no token is available", async () => {
		vi.mocked(loadNetBirdToken).mockReturnValue(null);

		const result = await ensureServiceRouting("cinny");
		expect(result.ok).toBe(false);
		expect(result.skipped).toBe(true);
		expect(getLocalMeshIp).not.toHaveBeenCalled();
	});

	it("creates DNS record when token is available", async () => {
		vi.mocked(loadNetBirdToken).mockReturnValue("nbp_test");
		vi.mocked(getLocalMeshIp).mockResolvedValue("100.119.45.12");
		vi.mocked(ensureBloomZone).mockResolvedValue({ ok: true, zoneId: "zone-1" });
		vi.mocked(ensureServiceRecord).mockResolvedValue({ ok: true, recordId: "rec-1" });

		const result = await ensureServiceRouting("dufs");
		expect(result.ok).toBe(true);
		expect(ensureBloomZone).toHaveBeenCalledWith("nbp_test");
		expect(ensureServiceRecord).toHaveBeenCalledWith("nbp_test", "zone-1", "dufs", "100.119.45.12");
	});

	it("handles mesh IP failure gracefully", async () => {
		vi.mocked(loadNetBirdToken).mockReturnValue("nbp_test");
		vi.mocked(getLocalMeshIp).mockResolvedValue(null);

		const result = await ensureServiceRouting("cinny");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("mesh IP");
	});

	it("handles zone creation failure gracefully", async () => {
		vi.mocked(loadNetBirdToken).mockReturnValue("nbp_test");
		vi.mocked(getLocalMeshIp).mockResolvedValue("100.119.45.12");
		vi.mocked(ensureBloomZone).mockResolvedValue({ ok: false, error: "API error" });

		const result = await ensureServiceRouting("cinny");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("API error");
	});

	it("handles record creation failure gracefully", async () => {
		vi.mocked(loadNetBirdToken).mockReturnValue("nbp_test");
		vi.mocked(getLocalMeshIp).mockResolvedValue("100.119.45.12");
		vi.mocked(ensureBloomZone).mockResolvedValue({ ok: true, zoneId: "zone-1" });
		vi.mocked(ensureServiceRecord).mockResolvedValue({ ok: false, error: "record limit reached" });

		const result = await ensureServiceRouting("cinny");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("record limit reached");
	});
});
