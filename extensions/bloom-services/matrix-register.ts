/**
 * Matrix account registration via the Client-Server API (UIA flow with registration token).
 * Used by service_pair to auto-create user and bot accounts on Continuwuity.
 */

export type RegisterResult = { ok: true; userId: string; accessToken: string } | { ok: false; error: string };

/**
 * Register a Matrix account using the standard UIA registration flow with a registration token.
 *
 * 1. POST /_matrix/client/v3/register (no auth) → 401 with session ID
 * 2. POST again with auth { type: "m.login.registration_token", token, session } → 200 with user_id
 */
export async function registerMatrixAccount(
	homeserver: string,
	username: string,
	password: string,
	registrationToken: string,
): Promise<RegisterResult> {
	const url = `${homeserver}/_matrix/client/v3/register`;

	try {
		// Step 1: Get session ID
		const step1 = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password }),
		});

		if (step1.status !== 401) {
			const body = await step1.json().catch(() => ({}));
			// If 200, registration succeeded without UIA (open registration)
			if (step1.ok && (body as Record<string, unknown>).user_id) {
				return {
					ok: true,
					userId: (body as Record<string, unknown>).user_id as string,
					accessToken: (body as Record<string, unknown>).access_token as string,
				};
			}
			const errMsg = (body as Record<string, unknown>).error as string | undefined;
			return { ok: false, error: errMsg ?? `Unexpected status ${step1.status}` };
		}

		const uia = (await step1.json()) as { session?: string };
		const session = uia.session;
		if (!session) {
			return { ok: false, error: "No session returned from registration endpoint" };
		}

		// Step 2: Complete registration with token
		const step2 = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username,
				password,
				auth: {
					type: "m.login.registration_token",
					token: registrationToken,
					session,
				},
			}),
		});

		const result = (await step2.json()) as Record<string, unknown>;

		if (!step2.ok) {
			const errcode = result.errcode as string | undefined;
			const error = result.error as string | undefined;
			if (errcode === "M_USER_IN_USE") {
				return { ok: false, error: `Username already taken: ${username}` };
			}
			if (step2.status === 401) {
				return { ok: false, error: "Invalid registration token" };
			}
			return { ok: false, error: error ?? `Registration failed (${errcode ?? step2.status})` };
		}

		return {
			ok: true,
			userId: result.user_id as string,
			accessToken: result.access_token as string,
		};
	} catch (err) {
		return { ok: false, error: `Connection failed: ${(err as Error).message}` };
	}
}
