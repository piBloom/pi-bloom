import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasWizardPrefill, isSystemReady, shouldAutoApply, shouldRedirectToSetup } from "../../core/chat-server/setup.js";

let tmpDir: string;
let systemReadyFile: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-setup-test-"));
	systemReadyFile = path.join(tmpDir, "system-ready");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isSystemReady", () => {
	it("returns false when system-ready file is absent", () => {
		expect(isSystemReady(systemReadyFile)).toBe(false);
	});

	it("returns true when system-ready file exists", () => {
		fs.writeFileSync(systemReadyFile, "");
		expect(isSystemReady(systemReadyFile)).toBe(true);
	});
});

describe("prefill helpers", () => {
	it("returns false when wizard prefill file is absent", () => {
		expect(hasWizardPrefill(path.join(tmpDir, "prefill.env"))).toBe(false);
	});

	it("returns true when wizard prefill file exists", () => {
		const prefillFile = path.join(tmpDir, "prefill.env");
		fs.writeFileSync(prefillFile, "PREFILL_PASSWORD=test\n");
		expect(hasWizardPrefill(prefillFile)).toBe(true);
	});

	it("returns true for auto-apply when prefill exists and system is not ready", () => {
		const prefillFile = path.join(tmpDir, "prefill.env");
		fs.writeFileSync(prefillFile, "PREFILL_PASSWORD=test\n");
		expect(shouldAutoApply(prefillFile, systemReadyFile)).toBe(true);
	});

	it("returns false for auto-apply when system is already ready", () => {
		const prefillFile = path.join(tmpDir, "prefill.env");
		fs.writeFileSync(prefillFile, "PREFILL_PASSWORD=test\n");
		fs.writeFileSync(systemReadyFile, "");
		expect(shouldAutoApply(prefillFile, systemReadyFile)).toBe(false);
	});
});

describe("shouldRedirectToSetup", () => {
	it("returns true for / when system is not ready", () => {
		expect(shouldRedirectToSetup("/", systemReadyFile)).toBe(true);
	});

	it("returns true for /chat when system is not ready", () => {
		expect(shouldRedirectToSetup("/chat", systemReadyFile)).toBe(true);
	});

	it("returns false for /setup when system is not ready", () => {
		expect(shouldRedirectToSetup("/setup", systemReadyFile)).toBe(false);
	});

	it("returns false for /setup/assets/foo.js when system is not ready", () => {
		expect(shouldRedirectToSetup("/setup/assets/foo.js", systemReadyFile)).toBe(false);
	});

	it("returns false for /terminal when system is not ready", () => {
		expect(shouldRedirectToSetup("/terminal", systemReadyFile)).toBe(false);
	});

	it("returns false for /terminal/ws when system is not ready", () => {
		expect(shouldRedirectToSetup("/terminal/ws", systemReadyFile)).toBe(false);
	});

	it("returns false for /api/setup/apply when system is not ready", () => {
		expect(shouldRedirectToSetup("/api/setup/apply", systemReadyFile)).toBe(false);
	});

	it("returns false for / when system is ready", () => {
		fs.writeFileSync(systemReadyFile, "");
		expect(shouldRedirectToSetup("/", systemReadyFile)).toBe(false);
	});

	it("returns false for /chat when system is ready", () => {
		fs.writeFileSync(systemReadyFile, "");
		expect(shouldRedirectToSetup("/chat", systemReadyFile)).toBe(false);
	});
});

describe("setup gate integration", () => {
	let gatelessServer: http.Server;
	let gatePort: number;
	let applyScript: string;
	let prefillFile: string;
	let scriptsDir: string;
	let originalPath: string;

	beforeAll(async () => {
		scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-setup-script-"));
		applyScript = path.join(scriptsDir, "apply.sh");
		const sudoScript = path.join(scriptsDir, "sudo");
		fs.writeFileSync(
			applyScript,
			"#!/usr/bin/env bash\nset -euo pipefail\necho \"netbird=${SETUP_NETBIRD_KEY:-}\" \n",
		);
		fs.writeFileSync(
			sudoScript,
			"#!/usr/bin/env bash\nset -euo pipefail\nwhile [[ $# -gt 0 ]]; do\n  case \"$1\" in\n    -n|--preserve-env=*) shift ;;\n    *) break ;;\n  esac\ndone\nexec \"$@\"\n",
		);
		fs.chmodSync(applyScript, 0o755);
		fs.chmodSync(sudoScript, 0o755);
		prefillFile = path.join(scriptsDir, "prefill.env");
		originalPath = process.env.PATH ?? "";
		process.env.PATH = `${scriptsDir}:${originalPath}`;
		process.env.NIXPI_SETUP_SUDO = sudoScript;

		const { createChatServer } = await import("../../core/chat-server/index.js");
		gatelessServer = createChatServer({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/test-chat-sessions-setup",
			idleTimeoutMs: 5000,
			maxSessions: 4,
			staticDir: "/tmp/nonexistent",
			systemReadyFile: "/tmp/this-file-does-not-exist-abc123",
			applyScript,
			prefillFile,
		});
		await new Promise<void>((resolve) => {
			gatelessServer.listen(0, "127.0.0.1", () => {
				gatePort = (gatelessServer.address() as { port: number }).port;
				resolve();
			});
		});
	});

	afterAll(() => {
		gatelessServer.close();
		process.env.PATH = originalPath;
		delete process.env.NIXPI_SETUP_SUDO;
		fs.rmSync(scriptsDir, { recursive: true, force: true });
	});

	it("redirects / to /setup when system-ready is absent", async () => {
		const res = await fetch(`http://127.0.0.1:${gatePort}/`, { redirect: "manual" });
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("/setup");
	});

	it("serves /setup without redirect when system-ready is absent", async () => {
		const res = await fetch(`http://127.0.0.1:${gatePort}/setup`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const html = await res.text();
		expect(html).toContain("NixPI Setup");
		expect(html).toContain("Netbird");
		expect(html).toContain("pi /login");
	});

	it("does not redirect /terminal when system-ready is absent", async () => {
		const res = await fetch(`http://127.0.0.1:${gatePort}/terminal`, { redirect: "manual" });
		expect(res.status).not.toBe(302);
	});

	it("returns 400 for /api/setup/apply with invalid JSON", async () => {
		const res = await fetch(`http://127.0.0.1:${gatePort}/api/setup/apply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{",
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for /api/setup/apply with valid non-object JSON", async () => {
		const res = await fetch(`http://127.0.0.1:${gatePort}/api/setup/apply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "null",
		});
		expect(res.status).toBe(400);
	});

	it("accepts an empty netbirdKey payload", async () => {
		const res = await fetch(`http://127.0.0.1:${gatePort}/api/setup/apply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ netbirdKey: "" }),
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("data: netbird=");
		expect(body).toContain("data: SETUP_COMPLETE");
	});

	it("auto-applies and redirects when a prefill marker file exists", async () => {
		fs.writeFileSync(prefillFile, "PREFILL_PASSWORD=test\n");
		const res = await fetch(`http://127.0.0.1:${gatePort}/setup`);
		const html = await res.text();
		const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
		const autoApplyScript = scripts.at(-1);
		expect(autoApplyScript).toBeTruthy();

		let loadHandler: (() => Promise<void>) | undefined;
		const fetchCalls: Array<{ url: string; body: string }> = [];
		const errNode = { textContent: "" };
		const logNode = { textContent: "", scrollTop: 0, scrollHeight: 0 };
		const window = {
			location: { href: "/setup" },
			addEventListener: (event: string, handler: () => Promise<void>) => {
				if (event === "load") loadHandler = handler;
			},
		};
		const context = vm.createContext({
			window,
			document: {
				getElementById: (id: string) => (id === "err-keys" ? errNode : logNode),
			},
			fetch: async (url: string, init?: { body?: string }) => {
				fetchCalls.push({ url, body: init?.body ?? "" });
				const chunks = ["data: SETUP_COMPLETE\n\n"];
				return {
					ok: true,
					body: {
						getReader() {
							let index = 0;
							return {
								async read() {
									if (index >= chunks.length) return { done: true, value: undefined };
									return { done: false, value: Buffer.from(chunks[index++]) };
								},
							};
						},
					},
				};
			},
			TextDecoder,
		});

		vm.runInContext(autoApplyScript ?? "", context);
		expect(loadHandler).toBeTruthy();
		await loadHandler?.();

		expect(fetchCalls).toEqual([{ url: "/api/setup/apply", body: '{"netbirdKey":""}' }]);
		expect(window.location.href).toBe("/");
	});

	it("shows an error when auto-apply fails", async () => {
		fs.writeFileSync(prefillFile, "PREFILL_PASSWORD=test\n");
		const res = await fetch(`http://127.0.0.1:${gatePort}/setup`);
		const html = await res.text();
		const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
		const autoApplyScript = scripts.at(-1);
		expect(autoApplyScript).toBeTruthy();

		let loadHandler: (() => Promise<void>) | undefined;
		const errNode = { textContent: "" };
		const logNode = { textContent: "", scrollTop: 0, scrollHeight: 0 };
		const context = vm.createContext({
			window: {
				location: { href: "/setup" },
				addEventListener: (event: string, handler: () => Promise<void>) => {
					if (event === "load") loadHandler = handler;
				},
			},
			document: {
				getElementById: (id: string) => (id === "err-keys" ? errNode : logNode),
			},
			fetch: async () => ({
				ok: true,
				body: {
					getReader() {
						let done = false;
						return {
							async read() {
								if (done) return { done: true, value: undefined };
								done = true;
								return { done: false, value: Buffer.from("data: SETUP_FAILED:1\n\n") };
							},
						};
					},
				},
			}),
			TextDecoder,
		});

		vm.runInContext(autoApplyScript ?? "", context);
		await loadHandler?.();

		expect(errNode.textContent).toBe("Setup failed. Check the log above.");
		expect(logNode.textContent).toContain("SETUP_FAILED:1");
	});

	it("shows an error when auto-apply request fails before SSE starts", async () => {
		fs.writeFileSync(prefillFile, "PREFILL_PASSWORD=test\n");
		const res = await fetch(`http://127.0.0.1:${gatePort}/setup`);
		const html = await res.text();
		const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
		const autoApplyScript = scripts.at(-1);
		expect(autoApplyScript).toBeTruthy();

		let loadHandler: (() => Promise<void>) | undefined;
		const errNode = { textContent: "" };
		const logNode = { textContent: "", scrollTop: 0, scrollHeight: 0 };
		const context = vm.createContext({
			window: {
				location: { href: "/setup" },
				addEventListener: (event: string, handler: () => Promise<void>) => {
					if (event === "load") loadHandler = handler;
				},
			},
			document: {
				getElementById: (id: string) => (id === "err-keys" ? errNode : logNode),
			},
			fetch: async () => {
				throw new Error("network down");
			},
			TextDecoder,
		});

		vm.runInContext(autoApplyScript ?? "", context);
		await loadHandler?.();

		expect(errNode.textContent).toBe("Setup failed. Check the log above.");
		expect(logNode.textContent).toContain("SETUP_FAILED:network");
	});
});
