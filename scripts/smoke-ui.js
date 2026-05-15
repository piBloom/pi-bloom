#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";

const cwd = new URL("..", import.meta.url).pathname;
const userDataDir = mkdtempSync(join(tmpdir(), "nixpi-bun-smoke-chrome-"));
const RPC_TIMEOUT_MS = 10_000;
const serverRuntime = process.env.NIXPI_SERVER_RUNTIME || process.execPath;
const serverEntry = process.env.NIXPI_SERVER_ENTRY || "server.js";

const port = await freePort();
const cdpPort = await freePort();

let server;
let chrome;
let ws;
let nextId = 1;
const pending = new Map();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

function chromiumBin() {
	if (process.env.CHROMIUM_BIN) {
		if (existsSync(process.env.CHROMIUM_BIN)) return process.env.CHROMIUM_BIN;
		throw new Error(`CHROMIUM_BIN not found: ${process.env.CHROMIUM_BIN}`);
	}

	const candidates = [
		"/nix/store/9fjg59mab9j8c5r61dx2k5gcbd2f5mpm-chromium-148.0.7778.96/bin/chromium",
		"chromium",
		"chromium-browser",
		"google-chrome",
	];

	for (const candidate of candidates) {
		if (candidate.includes("/") && existsSync(candidate)) return candidate;
		try {
			return execFileSync("which", [candidate], { encoding: "utf8" }).trim();
		} catch {}
	}
	return null;
}

function httpText(url) {
	return new Promise((resolve, reject) => {
		http
			.get(url, (res) => {
				let data = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => resolve(data));
			})
			.on("error", reject);
	});
}

function withTimeout(promise, label, ms = RPC_TIMEOUT_MS) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function cdp(method, params = {}) {
	const id = nextId++;
	return withTimeout(
		new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params }));
		}),
		method,
	).finally(() => pending.delete(id));
}

async function evalOk(expression) {
	const result = await cdp("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ||
				result.exceptionDetails.text ||
				"browser exception",
		);
	}
	return result.result.value;
}

async function waitForServer() {
	for (let i = 0; i < 80; i++) {
		try {
			if (
				(await httpText(`http://127.0.0.1:${port}/`)).includes(
					"<!doctype html>",
				)
			)
				return;
		} catch {}
		await wait(100);
	}
	throw new Error("server did not start");
}

async function waitForCdp() {
	for (let i = 0; i < 100; i++) {
		try {
			const pages = JSON.parse(
				await httpText(`http://127.0.0.1:${cdpPort}/json/list`),
			);
			const page = pages.find((entry) => entry.type === "page");
			if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		} catch {}
		await wait(100);
	}
	throw new Error("CDP did not start");
}

async function run() {
	const chromeBin = chromiumBin();
	if (!chromeBin) {
		console.log(
			"ui-smoke: SKIP (Chromium not found; set CHROMIUM_BIN to enable)",
		);
		return;
	}

	server = spawn(serverRuntime, [serverEntry], {
		cwd,
		env: {
			...process.env,
			NIXPI_HOST: "127.0.0.1",
			NIXPI_PORT: String(port),
			NIXPI_PI_BIN: "/run/current-system/sw/bin/false",
		},
		stdio: ["ignore", "ignore", "ignore"],
	});
	await waitForServer();

	chrome = spawn(
		chromeBin,
		[
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--disable-dev-shm-usage",
			`--remote-debugging-port=${cdpPort}`,
			`--user-data-dir=${userDataDir}`,
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "ignore"] },
	);

	const wsUrl = await waitForCdp();
	ws = new WebSocket(wsUrl);
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolve, reject } = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) reject(new Error(message.error.message));
		else resolve(message.result);
	};
	await withTimeout(
		new Promise((resolve, reject) => {
			ws.onopen = resolve;
			ws.onerror = () => reject(new Error("websocket open failed"));
		}),
		"websocket open",
	);

	await cdp("Page.enable");
	await cdp("Runtime.enable");
	await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/` });
	await evalOk(`new Promise(resolve => {
		if (document.readyState === 'complete') resolve(true);
		else window.addEventListener('load', () => resolve(true), { once: true });
	})`);
	await evalOk(`Promise.all([
		customElements.whenDefined('ds-button'),
		customElements.whenDefined('ds-input'),
		customElements.whenDefined('ds-session-item'),
		customElements.whenDefined('ds-avatar'),
	]).then(() => true)`);

	const rows = await evalOk(`(async () => {
		const rows = [];
		const ok = (name, value) => rows.push([name, Boolean(value)]);

		ok('custom-elements', ['ds-button','ds-input','ds-session-item','ds-avatar'].every((name) => customElements.get(name)));
		ok('no-inline-handlers', !document.querySelector('[onclick],[onchange],[oninput],[onkeydown],[onpaste]'));

		renderSessionList([
			{ file: 'alpha.jsonl', preview: 'Alpha <b>raw</b>', lastTimestamp: new Date().toISOString(), messageCount: 1 },
			{ file: 'beta.jsonl', preview: 'Beta session', lastTimestamp: new Date().toISOString(), messageCount: 2 },
		], 'alpha.jsonl');
		const sessions = [...document.querySelectorAll('ds-session-item')];
		ok('session-component-count', sessions.length === 2);
		ok('session-text-escaped', sessions[0].shadowRoot.querySelector('.title')?.textContent === 'Alpha <b>raw</b>' && !sessions[0].shadowRoot.querySelector('b'));

		const global = document.querySelector('#global-search');
		global.shadowRoot.querySelector('input').value = 'beta';
		global.shadowRoot.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
		ok('session-search', sessions[0].style.display === 'none' && sessions[1].style.display === 'block');

		allModels = [
			{ provider: 'p', id: 'one', name: 'One', input: ['text'] },
			{ provider: 'p', id: 'two', name: 'Two', input: ['text'] },
		];
		currentModel = allModels[0];
		filterModels('');
		const modelSearch = document.querySelector('#model-search');
		modelSearch.shadowRoot.querySelector('input').value = 'two';
		modelSearch.shadowRoot.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
		ok('model-search', document.querySelectorAll('#model-list ds-button').length === 1);

		const prompt = document.querySelector('#input');
		prompt.value = 'hello';
		prompt.focus();
		await new Promise((resolve) => setTimeout(resolve, 20));
		ok('prompt-value-focus', prompt.value === 'hello' && prompt.shadowRoot.activeElement === prompt.shadowRoot.querySelector('textarea'));
		document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
		ok('text-entry-shortcut-guard', !document.querySelector('#help-modal')?.open);

		addMsg('assistant', '**bold** [site](https://example.com)');
		const normal = document.querySelector('#messages [data-type="assistant"] .msg-markdown');
		const link = normal.querySelector('a');
		ok('markdown-normal', normal.querySelector('strong') && link?.target === '_blank' && link?.rel.includes('noopener'));
		const markedSaved = window.marked;
		const purifySaved = window.DOMPurify;
		window.marked = undefined;
		window.DOMPurify = undefined;
		addMsg('assistant', '**plain** <img src=x onerror="window.__bad=1">');
		const fallback = [...document.querySelectorAll('#messages [data-type="assistant"] .msg-markdown')].at(-1);
		ok('markdown-fallback-safe', fallback.querySelector('strong') && !fallback.querySelector('img') && fallback.textContent.includes('<img') && !window.__bad);
		window.marked = markedSaved;
		window.DOMPurify = purifySaved;

		return rows;
	})()`);

	for (const [name, ok] of rows) console.log(`${name}: ${ok ? "OK" : "FAIL"}`);
	if (rows.some(([, ok]) => !ok)) throw new Error("UI smoke failed");
}

try {
	await run();
} finally {
	try {
		ws?.close();
	} catch {}
	try {
		chrome?.kill("SIGTERM");
	} catch {}
	try {
		server?.kill("SIGTERM");
	} catch {}
	await wait(200);
	try {
		chrome?.kill("SIGKILL");
	} catch {}
	try {
		server?.kill("SIGKILL");
	} catch {}
	rmSync(userDataDir, { recursive: true, force: true });
}
