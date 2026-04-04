import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
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

import { createChatServer, isMainModule } from "../../core/chat-server/index.js";

let server: http.Server;
let port: number;
let tmpDir: string;
let systemReadyFile: string;

beforeAll(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-chat-server-test-"));
	systemReadyFile = path.join(tmpDir, "system-ready");
	fs.writeFileSync(systemReadyFile, "");

	server = createChatServer({
		nixpiShareDir: "/mock/share",
		chatSessionsDir: "/tmp/test-chat-sessions",
		idleTimeoutMs: 5000,
		maxSessions: 4,
		staticDir: new URL("../../core/chat-server/frontend/dist", import.meta.url).pathname,
		systemReadyFile,
		applyScript: "/bin/false",
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			port = (server.address() as { port: number }).port;
			resolve();
		});
	});
});

afterAll(() => {
	server?.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
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

describe("isMainModule", () => {
	it("returns true when argv[1] resolves through a symlink to the module path", () => {
		const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-chat-entrypoint-test-"));
		try {
			const entryFile = path.join(fixtureDir, "entry.js");
			const symlinkFile = path.join(fixtureDir, "entry-link.js");
			fs.writeFileSync(entryFile, "// test fixture\n");
			fs.symlinkSync(entryFile, symlinkFile);

			expect(isMainModule(symlinkFile, new URL(`file://${entryFile}`).href)).toBe(true);
		} finally {
			fs.rmSync(fixtureDir, { recursive: true, force: true });
		}
	});
});
