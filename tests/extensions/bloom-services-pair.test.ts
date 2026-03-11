import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMatrixAccount } from "../../extensions/bloom-services/matrix-register.js";

const HOMESERVER = "http://localhost:6167";

afterEach(() => {
	vi.restoreAllMocks();
});

/** Simulates the Matrix UIA registration flow. */
function mockMatrixRegister(opts: { validToken?: string; existingUsers?: string[] } = {}) {
	const validToken = opts.validToken ?? "test-reg-token";
	const existing = new Set(opts.existingUsers ?? []);

	vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
		const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
		const auth = body.auth as Record<string, unknown> | undefined;

		// Step 1: No auth → 401 with session
		if (!auth) {
			return new Response(
				JSON.stringify({
					session: "test-session",
					flows: [{ stages: ["m.login.registration_token"] }],
				}),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		}

		// Step 2: Wrong token → 401 again
		if (auth.token !== validToken) {
			return new Response(
				JSON.stringify({
					session: auth.session,
					flows: [{ stages: ["m.login.registration_token"] }],
					completed: [],
				}),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		}

		// Step 2: User exists → 400
		const username = body.username as string;
		if (existing.has(username)) {
			return new Response(JSON.stringify({ errcode: "M_USER_IN_USE", error: "User ID already taken" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Step 2: Success
		existing.add(username);
		return new Response(
			JSON.stringify({
				user_id: `@${username}:bloom`,
				access_token: `access-token-for-${username}`,
				device_id: `DEVICE_${username}`,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	});
}

// ---------------------------------------------------------------------------
// registerMatrixAccount
// ---------------------------------------------------------------------------
describe("registerMatrixAccount", () => {
	it("registers a new account with valid token", async () => {
		mockMatrixRegister();
		const result = await registerMatrixAccount(HOMESERVER, "alex", "s3cret!", "test-reg-token");
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unexpected");
		expect(result.userId).toBe("@alex:bloom");
	});

	it("returns error when registration token is invalid", async () => {
		mockMatrixRegister();
		const result = await registerMatrixAccount(HOMESERVER, "alex", "s3cret!", "wrong-token");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unexpected");
		expect(result.error).toContain("registration");
	});

	it("returns error when username is already taken", async () => {
		mockMatrixRegister({ existingUsers: ["taken"] });
		const result = await registerMatrixAccount(HOMESERVER, "taken", "s3cret!", "test-reg-token");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unexpected");
		expect(result.error).toContain("taken");
	});

	it("registers multiple accounts sequentially", async () => {
		mockMatrixRegister();
		const r1 = await registerMatrixAccount(HOMESERVER, "user1", "pass1", "test-reg-token");
		const r2 = await registerMatrixAccount(HOMESERVER, "pi", "pass2", "test-reg-token");
		expect(r1.ok).toBe(true);
		if (!r1.ok) throw new Error("unexpected");
		expect(r1.userId).toBe("@user1:bloom");
		expect(r2.ok).toBe(true);
		if (!r2.ok) throw new Error("unexpected");
		expect(r2.userId).toBe("@pi:bloom");
	});

	it("returns error when homeserver is unreachable", async () => {
		// Don't mock — let it fail naturally
		const result = await registerMatrixAccount("http://localhost:1", "alex", "pass", "token");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unexpected");
		expect(result.error).toBeDefined();
	});
});
