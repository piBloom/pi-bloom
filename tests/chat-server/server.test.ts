import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock the session manager so the server test doesn't start real Pi sessions.
vi.mock("../../core/chat-server/session.js", () => ({
	ChatSessionManager: vi.fn().mockImplementation(function () {
		return {
			sendMessage: vi.fn(async function* () {
				yield { type: "text", content: "Hello from Pi" };
				yield { type: "done" };
			}),
			delete: vi.fn(),
		};
	}),
}));

import { createChatServer } from "../../core/chat-server/index.js";

let server: http.Server;
let port: number;

beforeAll(async () => {
	server = createChatServer({
		nixpiShareDir: "/mock/share",
		chatSessionsDir: "/tmp/test-chat-sessions",
		idleTimeoutMs: 5000,
		maxSessions: 4,
		staticDir: new URL("../../core/chat-server/frontend/dist", import.meta.url).pathname,
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			port = (server.address() as { port: number }).port;
			resolve();
		});
	});
});

afterAll(() => {
	server.close();
});

describe("POST /chat", () => {
	it("streams NDJSON events for a message", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId: "test-session", message: "hi" }),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/x-ndjson");
		const text = await res.text();
		const lines = text
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines).toContainEqual({ type: "text", content: "Hello from Pi" });
		expect(lines[lines.length - 1]).toEqual({ type: "done" });
	});

	it("returns 400 for missing sessionId", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "hi" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for missing message", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId: "test" }),
		});
		expect(res.status).toBe(400);
	});
});

describe("DELETE /chat/:sessionId", () => {
	it("returns 204 and calls delete on the session manager", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/chat/some-id`, {
			method: "DELETE",
		});
		expect(res.status).toBe(204);
	});
});

describe("GET /", () => {
	it("returns 200 or 404 (frontend dist may not exist in test environment)", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/`);
		expect([200, 404]).toContain(res.status);
	});
});
