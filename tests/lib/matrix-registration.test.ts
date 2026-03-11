import { afterEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { registerMatrixAccount } from "../../lib/matrix.js";

describe("registerMatrixAccount", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers successfully on direct 200 (no UIA)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ user_id: "@test:bloom", access_token: "tok123" }),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: true, userId: "@test:bloom", accessToken: "tok123" });
	});

	it("handles UIA 401 flow with registration token", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({ session: "sess123" }),
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ user_id: "@test:bloom", access_token: "tok456" }),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: true, userId: "@test:bloom", accessToken: "tok456" });
	});

	it("returns error for M_USER_IN_USE", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: async () => ({ errcode: "M_USER_IN_USE", error: "User ID already taken" }),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: false, error: "Username is already taken." });
	});

	it("returns error when 401 has no session", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({}),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: false, error: "No session ID in 401 response" });
	});
});
