/**
 * Pure Matrix utility functions.
 * No side effects — all I/O is handled by callers.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import { join } from "node:path";

/** Path to stored Matrix credentials. */
export function matrixCredentialsPath(): string {
	return join(os.homedir(), ".pi", "matrix-credentials.json");
}

/** Generate a secure random password (base64url, 24 bytes = 32 chars). */
export function generatePassword(bytes = 24): string {
	return randomBytes(bytes).toString("base64url");
}

/** Matrix credentials structure stored on disk. */
export interface MatrixCredentials {
	homeserver: string;
	botUserId: string;
	botAccessToken: string;
	botPassword: string;
	userUserId?: string;
	userPassword?: string;
	registrationToken: string;
}

/**
 * Register a new Matrix account via the UIA (User-Interactive Authentication) flow.
 * Uses a registration token to authorize the account creation.
 */
export async function registerMatrixAccount(
	homeserver: string,
	username: string,
	password: string,
	registrationToken: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
	const url = `${homeserver}/_matrix/client/v3/register`;
	const body = { username, password, auth: {}, inhibit_login: false };

	const step1 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (step1.ok) {
		const data = (await step1.json()) as { user_id: string; access_token: string };
		return { ok: true, userId: data.user_id, accessToken: data.access_token };
	}

	const step1Body = (await step1.json()) as { session?: string; errcode?: string; error?: string };

	if (step1.status !== 401) {
		return parseRegistrationError(step1Body, step1.status);
	}

	const session = step1Body.session;
	if (!session) return { ok: false, error: "No session ID in 401 response" };

	return registerStep2(url, username, password, registrationToken, session);
}

async function registerStep2(
	url: string,
	username: string,
	password: string,
	registrationToken: string,
	session: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
	const step2Body = {
		username,
		password,
		inhibit_login: false,
		auth: { type: "m.login.registration_token", token: registrationToken, session },
	};

	const step2 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(step2Body),
	});

	if (step2.ok) {
		const data = (await step2.json()) as { user_id: string; access_token: string };
		return { ok: true, userId: data.user_id, accessToken: data.access_token };
	}

	if (step2.status === 401) return { ok: false, error: "Invalid registration token" };
	return parseRegistrationError(await step2.json(), step2.status);
}

function parseRegistrationError(err: unknown, status: number): { ok: false; error: string } {
	const e = err as { errcode?: string; error?: string };
	if (e.errcode === "M_USER_IN_USE") return { ok: false, error: "Username is already taken." };
	return { ok: false, error: e.error ?? `Registration failed (${status})` };
}
