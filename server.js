/**
 * nixpi — Web UI for Pi Coding Agent
 *
 * Spawns `pi --mode rpc` as a subprocess and bridges JSON-RPC
 * to browser clients over WebSocket.
 *
 * Supports multiple named workspaces, each with its own CWD and pi
 * subprocess. Only the active workspace's pi runs; others are lazily
 * killed after an idle timeout.
 *
 * Usage:
 *   node server.js                          # defaults
 *   NIXPI_PORT=8080 NIXPI_CWD=/path node server.js
 *   NIXPI_WORKSPACES_CONFIG=/path/to/workspaces.json node server.js
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import express from "express";
import { WebSocketServer } from "ws";

// ── Config ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.NIXPI_PORT || "4815", 10);
const HOST = process.env.NIXPI_HOST || "0.0.0.0";
const CWD = process.env.NIXPI_CWD || process.env.HOME;
const PI_BIN = process.env.NIXPI_PI_BIN || "pi";
const SSH_BIN = process.env.NIXPI_SSH_BIN || "ssh";
console.log(
	`[DEBUG] SSH_BIN=${SSH_BIN} NIXPI_SSH_BIN=${process.env.NIXPI_SSH_BIN} PATH=${process.env.PATH?.split(":").length} entries`,
);
const WORKSPACES_CONFIG = process.env.NIXPI_WORKSPACES_CONFIG || "";
const IDLE_TIMEOUT_MS = parseInt(
	process.env.NIXPI_IDLE_TIMEOUT_MS || "300000",
	10,
); // 5 min default
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Module path resolution (handles hoisted node_modules via npx) ──────────
const _require = createRequire(import.meta.url);

function resolveModuleFile(pkgName, subpath) {
	try {
		const mainPath = _require.resolve(pkgName);
		// Walk up to find the package root (where package.json lives)
		let dir = dirname(mainPath);
		while (dir !== dirname(dir)) {
			if (existsSync(join(dir, "package.json"))) break;
			dir = dirname(dir);
		}
		return join(dir, subpath);
	} catch {
		// Fallback: assume package is installed alongside this package
		return join(__dirname, "node_modules", pkgName, subpath);
	}
}

const MARKED_UMD_PATH = resolveModuleFile("marked", "lib/marked.umd.js");
const DOMPURIFY_PATH = resolveModuleFile("dompurify", "dist/purify.js");

// ── Workspaces ──────────────────────────────────────────────────────────
// Workspace config is loaded from workspaces.json (Nix-managed).
// Each workspace has: name, cwd, mode ("local"|"ssh"), context, and
// optional sshHost/sshUser for remote workspaces.

const workspaceConfig = (() => {
	if (!WORKSPACES_CONFIG) return null;
	try {
		const raw = readFileSync(WORKSPACES_CONFIG, "utf8");
		return JSON.parse(raw);
	} catch (e) {
		console.error(
			`  workspaces config: failed to load ${WORKSPACES_CONFIG}:`,
			e.message,
		);
		return null;
	}
})();

const workspaces = new Map(); // name → workspace state
let activeWorkspaceName = null;

function initWorkspaces() {
	if (!workspaceConfig?.workspaces) {
		// Legacy single-workspace mode (no workspaces.json)
		workspaces.set("default", {
			name: "default",
			cwd: CWD,
			mode: "local",
			context: "",
			sshHost: null,
			sshUser: "alex",
			// Runtime state
			piProc: null,
			busy: false,
			piConnected: false,
			piHealthInterval: null,
			idleTimer: null,
			lineBuffer: "",
			requestId: 0,
			pendingRequests: new Map(),
			restarting: false,
			cachedCommands: [],
			currentSessionFile: null,
			currentSessionId: null,
			historyLoadPending: false,
			currentModel: null,
			currentThinkingLevel: "medium",
		});
		activeWorkspaceName = "default";
		return;
	}

	const defaultName =
		workspaceConfig.default || Object.keys(workspaceConfig.workspaces)[0];
	for (const [name, ws] of Object.entries(workspaceConfig.workspaces)) {
		workspaces.set(name, {
			name,
			cwd: ws.cwd || CWD,
			mode: ws.mode || "local",
			sshHost: ws.sshHost || null,
			sshUser: ws.sshUser || "alex",
			context: ws.context || "",
			// Runtime state
			piProc: null,
			busy: false,
			piConnected: false,
			piHealthInterval: null,
			idleTimer: null,
			lineBuffer: "",
			requestId: 0,
			pendingRequests: new Map(),
			restarting: false,
			cachedCommands: [],
			currentSessionFile: null,
			currentSessionId: null,
			historyLoadPending: false,
			currentModel: null,
			currentThinkingLevel: "medium",
		});
	}
	activeWorkspaceName = defaultName;
}

function getActive() {
	return workspaces.get(activeWorkspaceName);
}

// Kill a workspace's pi subprocess after idle timeout.
function scheduleIdleKill(ws) {
	clearIdleTimer(ws);
	ws.idleTimer = setTimeout(() => {
		if (ws.piProc && !ws.piProc.killed && !ws.busy) {
			console.log(
				`  [idle] killing pi for workspace '${ws.name}' after ${IDLE_TIMEOUT_MS / 1000}s idle`,
			);
			ws.piProc.kill("SIGTERM");
			ws.piProc = null;
			ws.piConnected = false;
			broadcast({
				type: "pi_health",
				connected: false,
				busy: false,
				workspace: ws.name,
			});
		}
		ws.idleTimer = null;
	}, IDLE_TIMEOUT_MS);
}

function clearIdleTimer(ws) {
	if (ws.idleTimer) {
		clearTimeout(ws.idleTimer);
		ws.idleTimer = null;
	}
}

function switchWorkspace(name) {
	if (!workspaces.has(name)) return;
	if (name === activeWorkspaceName) return;

	const oldWs = getActive();
	const newWs = workspaces.get(name);

	// Schedule idle kill for the old workspace's pi
	if (oldWs.piProc && !oldWs.piProc.killed && !oldWs.busy) {
		scheduleIdleKill(oldWs);
	}

	activeWorkspaceName = name;
	console.log(`  switched to workspace '${name}'`);

	// Notify all clients about the switch
	broadcast({
		type: "workspace_switched",
		workspace: name,
		workspaces: getWorkspacesInfo(),
	});

	// Ensure the new workspace has pi running
	ensurePi(newWs);
	clearIdleTimer(newWs);
}

function getWorkspacesInfo() {
	const result = {};
	for (const [name, ws] of workspaces) {
		result[name] = {
			name,
			cwd: ws.cwd,
			mode: ws.mode,
			context: ws.context,
			active: name === activeWorkspaceName,
			piConnected: ws.piConnected,
			busy: ws.busy,
		};
	}
	return result;
}

initWorkspaces();

// ── State ───────────────────────────────────────────────────────────────
const clients = new Set();

// ── Session utilities ────────────────────────────────────────────────────
function parseSessions(ws) {
	ws = ws || getActive();
	const homeDir = process.env.HOME || "";
	const sessionBaseDir = join(homeDir, ".pi", "agent", "sessions");
	// /home/alex/repos/nixpi → --home-alex-repos-nixpi--
	const cwdKey = "--" + ws.cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
	const sessionDir = join(sessionBaseDir, cwdKey);

	if (!existsSync(sessionDir)) return [];

	const files = readdirSync(sessionDir)
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => join(sessionDir, f));

	const sessions = [];
	for (const file of files) {
		try {
			const content = readFileSync(file, "utf8");
			const lines = content
				.trim()
				.split("\n")
				.filter((l) => l.trim());

			let header = null;
			let name = null;
			let firstUserMessage = null;
			let messageCount = 0;
			let lastTimestamp = null;

			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					if (entry.type === "session") {
						header = entry;
					} else if (entry.type === "session_info" && entry.name) {
						name = entry.name; // keep latest
					} else if (entry.type === "message") {
						if (entry.message?.role === "user") {
							if (!firstUserMessage) {
								const c = entry.message.content;
								if (typeof c === "string") firstUserMessage = c.slice(0, 80);
								else if (Array.isArray(c)) {
									const t = c.find((b) => b.type === "text");
									if (t) firstUserMessage = t.text.slice(0, 80);
								}
							}
							messageCount++;
						} else if (entry.message?.role === "assistant") {
							messageCount++;
						}
						if (entry.timestamp) lastTimestamp = entry.timestamp;
					}
				} catch {}
			}

			if (!header) continue;

			sessions.push({
				id: header.id,
				file,
				cwd: header.cwd || ws.cwd,
				timestamp: header.timestamp,
				lastTimestamp: lastTimestamp || header.timestamp,
				name,
				preview: name || firstUserMessage || "New session",
				messageCount,
			});
		} catch {}
	}

	sessions.sort(
		(a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp),
	);
	return sessions;
}

// ── Express ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(
	"/assets",
	express.static(join(__dirname, "public/assets"), { dotfiles: "allow" }),
);

app.get("/", (_req, res) => {
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.sendFile(join(__dirname, "public", "index.html"), { dotfiles: "allow" });
});

// Serve bundled JS libs (resolved dynamically to handle hoisted node_modules)
app.get("/lib/marked.umd.js", (_req, res) =>
	res.sendFile(MARKED_UMD_PATH, { dotfiles: "allow" }),
);
app.get("/lib/purify.js", (_req, res) =>
	res.sendFile(DOMPURIFY_PATH, { dotfiles: "allow" }),
);

app.get("/favicon.ico", (_req, res) => {
	res.setHeader("Content-Type", "image/svg+xml");
	res.send(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="24" font-size="24" fill="#6EA8DB">π</text></svg>`,
	);
});

// ── Design System Showcase ──────────────────────────────────────────────
// Proxy /storybook/* to the web-dev-server on localhost:4820 so
// TypeScript files get transpiled on the fly and live reload works.
app.use("/storybook", (req, res) => {
	const isRoot = req.url === "" || req.url === "/";
	let targetPath = isRoot ? "/showcase/index.html" : req.url;

	// ES modules omit .ts extension; add it when requesting from WDS
	if (!isRoot) {
		const base = basename(targetPath);
		if (!base.includes(".") && base.startsWith("ds-")) {
			targetPath += ".ts";
		}
	}

	const targetUrl = `http://127.0.0.1:4820${targetPath}`;

	const proxyRequest = (http) => {
		const upstream = http.get(
			targetUrl,
			{ headers: { ...req.headers, host: "127.0.0.1:4820" } },
			(uresp) => {
				res.status(uresp.statusCode ?? 200);
				uresp.headers &&
					Object.entries(uresp.headers).forEach(([k, v]) =>
						res.setHeader(k, v),
					);
				let body = "";
				uresp.on("data", (c) => {
					body += c;
				});
				uresp.on("end", () => {
					if (targetPath.endsWith(".html")) {
						// Rewrite absolute paths so the showcase works under /storybook/
						res.send(body.replace(/(href|src)="\//g, '$1="/storybook/'));
						return;
					}
					res.send(body);
				});
				uresp.on("error", (err) =>
					res.status(502).send(`Upstream error: ${err.message}`),
				);
			},
		);
		upstream.on("error", (err) =>
			res
				.status(503)
				.send(`Design System dev server unavailable: ${err.message}`),
		);
		req.pipe ? req.pipe(upstream) : null;
	};

	import("node:http")
		.then((http) => proxyRequest(http))
		.catch(() => {
			// Fallback: try import('https') in case of SSL — not used for localhost
			res.status(503).send("Design System dev server unavailable");
		});
});

app.get("/manifest.json", (_req, res) => {
	res.setHeader("Content-Type", "application/json");
	res.json({
		name: "nixpi",
		short_name: "nixpi",
		start_url: "/",
		display: "standalone",
		background_color: "#1a1a2e",
		theme_color: "#6EA8DB",
		icons: [{ src: "/favicon.ico", sizes: "any", type: "image/svg+xml" }],
	});
});

// Session list REST endpoint
app.get("/api/sessions", (_req, res) => {
	try {
		const ws = getActive();
		res.json({
			sessions: parseSessions(ws),
			currentFile: ws.currentSessionFile,
		});
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

// List archived sessions
app.get("/api/sessions/archived", (_req, res) => {
	try {
		const ws = getActive();
		const sessionBaseDir = join(
			process.env.HOME || "",
			".pi",
			"agent",
			"sessions",
		);
		const cwdKey = "--" + ws.cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
		const archiveDir = join(sessionBaseDir, cwdKey, "archived");
		if (!existsSync(archiveDir)) return res.json({ sessions: [] });
		const files = readdirSync(archiveDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => join(archiveDir, f));
		const sessions = [];
		for (const file of files) {
			try {
				const lines = readFileSync(file, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean);
				let header = null,
					name = null,
					firstUserMessage = null,
					lastTimestamp = null;
				for (const line of lines) {
					try {
						const e = JSON.parse(line);
						if (e.type === "session") header = e;
						else if (e.type === "session_info" && e.name) name = e.name;
						else if (
							e.type === "message" &&
							e.message?.role === "user" &&
							!firstUserMessage
						) {
							const c = e.message.content;
							firstUserMessage =
								typeof c === "string"
									? c.slice(0, 80)
									: Array.isArray(c)
										? (c.find((b) => b.type === "text")?.text || "").slice(
												0,
												80,
											)
										: "";
						}
						if (e.timestamp) lastTimestamp = e.timestamp;
					} catch {}
				}
				if (!header) continue;
				sessions.push({
					id: header.id,
					file,
					timestamp: header.timestamp,
					lastTimestamp: lastTimestamp || header.timestamp,
					name,
					preview: name || firstUserMessage || "Archived session",
				});
			} catch {}
		}
		sessions.sort(
			(a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp),
		);
		res.json({ sessions });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

// Restore archived session
app.post("/api/sessions/restore", (req, res) => {
	const { file } = req.body || {};
	if (!file || !file.endsWith(".jsonl"))
		return res.status(400).json({ error: "Invalid file" });
	const sessionBaseDir = join(
		process.env.HOME || "",
		".pi",
		"agent",
		"sessions",
	);
	if (!file.startsWith(sessionBaseDir))
		return res.status(403).json({ error: "Forbidden" });
	try {
		const dest = join(dirname(file), "..", basename(file));
		renameSync(file, dest);
		res.json({ ok: true, restoredTo: dest });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

// Archive session (move to archived/ subfolder)
app.post("/api/sessions/archive", (req, res) => {
	const { file } = req.body || {};
	if (!file || !file.endsWith(".jsonl"))
		return res.status(400).json({ error: "Invalid file" });
	const sessionBaseDir = join(
		process.env.HOME || "",
		".pi",
		"agent",
		"sessions",
	);
	if (!file.startsWith(sessionBaseDir))
		return res.status(403).json({ error: "Forbidden" });
	try {
		const archiveDir = join(dirname(file), "archived");
		if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
		const dest = join(archiveDir, basename(file));
		renameSync(file, dest);
		res.json({ ok: true, archivedTo: dest });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

// Delete session permanently
app.delete("/api/sessions", (req, res) => {
	const { file } = req.body || {};
	if (!file || !file.endsWith(".jsonl"))
		return res.status(400).json({ error: "Invalid file" });
	const sessionBaseDir = join(
		process.env.HOME || "",
		".pi",
		"agent",
		"sessions",
	);
	if (!file.startsWith(sessionBaseDir))
		return res.status(403).json({ error: "Forbidden" });
	try {
		unlinkSync(file);
		res.json({ ok: true });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

// Restart Pi subprocess (active workspace)
app.post("/api/restart", (_req, res) => {
	try {
		const ws = getActive();
		ws.restarting = true;
		if (ws.piProc && !ws.piProc.killed) {
			ws.piProc.kill("SIGTERM");
			ws.piProc = null;
		}
		ws.busy = false;
		setPiHealth(ws, false);
		broadcast({
			type: "status",
			busy: false,
			piConnected: false,
			workspace: ws.name,
		});
		setTimeout(() => {
			ensurePi(ws);
			setTimeout(() => {
				ws.restarting = false;
			}, 2000);
		}, 500);
		res.json({ ok: true });
	} catch (e) {
		const ws = getActive();
		ws.restarting = false;
		res.status(500).json({ error: e.message });
	}
});

// Workspace list REST endpoint
app.get("/api/workspaces", (_req, res) => {
	res.json(getWorkspacesInfo());
});

// ── Whisper Speech-to-Text ──────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

app.post(
	"/api/transcribe",
	express.raw({ type: "audio/webm", limit: "25mb" }),
	async (req, res) => {
		if (!OPENAI_API_KEY)
			return res.status(500).json({ error: "OPENAI_API_KEY not set" });
		if (!req.body?.length)
			return res.status(400).json({ error: "No audio data" });
		try {
			const { default: fetch } = await import("node-fetch");
			const FormData = (await import("form-data")).default;
			const form = new FormData();
			form.append("file", req.body, {
				filename: "audio.webm",
				contentType: "audio/webm",
			});
			form.append("model", "whisper-1");
			form.append("language", "en");
			form.append("response_format", "json");
			const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${OPENAI_API_KEY}`,
					...form.getHeaders(),
				},
				body: form,
			});
			if (!r.ok) {
				const errText = await r.text();
				console.error("Whisper error:", r.status, errText);
				return res
					.status(r.status)
					.json({ error: `Whisper API error: ${r.status}` });
			}
			const data = await r.json();
			res.json({ text: data.text || "" });
		} catch (e) {
			console.error("Transcription error:", e);
			res.status(500).json({ error: e.message });
		}
	},
);

const server = app.listen(PORT, HOST, () => {
	console.log(`✓ nixpi http://${HOST}:${PORT}`);
});

server.on("error", (err) => {
	if (err.code === "EADDRINUSE") {
		console.error(`❌ Port ${PORT} is already in use.`);
		console.error("   Make sure no other instance of nixpi is running.");
		console.error("   Run: ./nixpi.sh stop");
		process.exit(1);
	} else {
		console.error("Server error:", err);
		process.exit(1);
	}
});

// ── WebSocket ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
	clients.add(ws);
	const active = getActive();
	ws.send(
		JSON.stringify({
			type: "status",
			busy: active.busy,
			connected: true,
			piConnected: active.piConnected,
			workspace: active.name,
			workspaces: getWorkspacesInfo(),
		}),
	);
	if (active.cachedCommands.length > 0) {
		ws.send(
			JSON.stringify({ type: "commands", commands: active.cachedCommands }),
		);
	}
	if (active.currentSessionFile || active.currentModel) {
		ws.send(
			JSON.stringify({
				type: "session_state",
				sessionFile: active.currentSessionFile,
				sessionId: active.currentSessionId,
				model: active.currentModel,
				thinkingLevel: active.currentThinkingLevel,
			}),
		);
	}
	console.log(`↔ client connected (${clients.size})`);

	ws.on("message", (raw) => {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		handleClientMessage(ws, msg);
	});

	ws.on("close", () => {
		clients.delete(ws);
		console.log(`↔ client disconnected (${clients.size})`);
	});
});

function broadcast(data) {
	const s = JSON.stringify(data);
	for (const ws of clients) {
		if (ws.readyState === 1) ws.send(s);
	}
}

// ── Client message handler ─────────────────────────────────────────────
async function handleClientMessage(clientWs, msg) {
	switch (msg.type) {
		case "switch_workspace": {
			if (!msg.name) return;
			switchWorkspace(msg.name);
			// After switching, send the new active workspace's full state
			const active = getActive();
			clientWs.send(
				JSON.stringify({
					type: "status",
					busy: active.busy,
					connected: true,
					piConnected: active.piConnected,
					workspace: active.name,
					workspaces: getWorkspacesInfo(),
				}),
			);
			if (active.cachedCommands.length > 0) {
				clientWs.send(
					JSON.stringify({ type: "commands", commands: active.cachedCommands }),
				);
			}
			if (active.currentSessionFile || active.currentModel) {
				clientWs.send(
					JSON.stringify({
						type: "session_state",
						sessionFile: active.currentSessionFile,
						sessionId: active.currentSessionId,
						model: active.currentModel,
						thinkingLevel: active.currentThinkingLevel,
					}),
				);
			}
			break;
		}

		case "list_workspaces": {
			clientWs.send(
				JSON.stringify({
					type: "workspaces",
					workspaces: getWorkspacesInfo(),
					active: activeWorkspaceName,
				}),
			);
			break;
		}

		case "prompt": {
			if (!msg.text?.trim()) return;
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			if (ws.busy) {
				// Pi supports queuing via streamingBehavior
				const qParams = { message: msg.text, streamingBehavior: "followUp" };
				if (msg.images?.length) qParams.images = msg.images;
				sendRpc(ws, "prompt", qParams);
			} else {
				ws.busy = true;
				broadcast({ type: "status", busy: true, workspace: ws.name });
				broadcast({ type: "agent_start" });
				const promptParams = { message: msg.text };
				if (msg.images?.length) promptParams.images = msg.images;
				sendRpc(ws, "prompt", promptParams);
			}
			break;
		}

		case "abort": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "abort", {});
			ws.busy = false;
			broadcast({
				type: "status",
				busy: false,
				aborted: true,
				workspace: ws.name,
			});
			broadcast({ type: "agent_end" });
			break;
		}

		case "new_session": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "new_session", {});
			ws.busy = false;
			broadcast({ type: "status", busy: false, workspace: ws.name });
			broadcast({ type: "session_reset" });
			setTimeout(() => {
				sendRpc(ws, "get_commands", {});
				sendRpc(ws, "get_state", {});
			}, 500);
			break;
		}

		case "switch_session": {
			if (!msg.sessionPath) return;
			const ws = getActive();
			if (ws.busy) {
				clientWs.send(
					JSON.stringify({
						type: "error",
						message: "Agent is busy. Stop before switching sessions.",
					}),
				);
				return;
			}
			clearIdleTimer(ws);
			ensurePi(ws);
			ws.pendingRequests.set("switch_session_path", msg.sessionPath);
			sendRpc(ws, "switch_session", { sessionPath: msg.sessionPath });
			break;
		}

		case "load_history": {
			const ws = getActive();
			if (ws.busy) return;
			clearIdleTimer(ws);
			ensurePi(ws);
			ws.historyLoadPending = true;
			sendRpc(ws, "get_messages", {});
			break;
		}

		case "set_session_name": {
			if (typeof msg.name !== "string") return;
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "set_session_name", { name: msg.name });
			break;
		}

		case "set_model": {
			if (!msg.provider || !msg.modelId) return;
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "set_model", {
				provider: msg.provider,
				modelId: msg.modelId,
			});
			break;
		}
		case "cycle_model": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "cycle_model", {});
			break;
		}
		case "set_thinking_level": {
			if (!msg.level) return;
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "set_thinking_level", { level: msg.level });
			break;
		}
		case "cycle_thinking_level": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "cycle_thinking_level", {});
			break;
		}
		case "get_stats": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "get_session_stats", {});
			break;
		}
		case "get_models": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "get_available_models", {});
			break;
		}
		case "export_request": {
			const ws = getActive();
			clearIdleTimer(ws);
			ensurePi(ws);
			sendRpc(ws, "get_messages", {});
			ws.pendingRequests.set("export", {
				resolve: (messages) => {
					broadcast({
						type: "export_response",
						session: {
							messages,
							exportedAt: new Date().toISOString(),
							cwd: ws.cwd,
						},
					});
				},
			});
			break;
		}
	}
}

// ── Pi RPC subprocess ──────────────────────────────────────────────────
function setPiHealth(ws, connected) {
	const changed = ws.piConnected !== connected;
	ws.piConnected = connected;
	if (changed) {
		broadcast({
			type: "pi_health",
			connected,
			busy: ws.busy,
			workspace: ws.name,
		});
		console.log(
			`  pi health [${ws.name}]: ${connected ? "CONNECTED" : "DISCONNECTED"}`,
		);
	}
}

function startPiHeartbeat(ws) {
	if (ws.piHealthInterval) clearInterval(ws.piHealthInterval);
	ws.piHealthInterval = setInterval(() => {
		if (!ws.piProc || ws.piProc.killed) {
			setPiHealth(ws, false);
		}
	}, 10000);
}

function ensurePi(ws) {
	ws = ws || getActive();
	if (ws.piProc && !ws.piProc.killed) return;

	// Build spawn command: for SSH-mode workspaces, tunnel pi over SSH.
	// Local:  spawn("pi", ["--mode", "rpc"])
	// SSH:    spawn("ssh", ["alex@10.10.10.30", "pi", "--mode", "rpc"])
	let spawnBin, spawnArgs, spawnCwd;
	if (ws.mode === "ssh" && ws.sshHost) {
		spawnBin = SSH_BIN;
		spawnArgs = [
			"-T", // no PTY
			"-o",
			"StrictHostKeyChecking=accept-new",
			"-o",
			"ServerAliveInterval=30",
			"-o",
			"ServerAliveCountMax=3",
			`${ws.sshUser}@${ws.sshHost}`,
			"pi",
			"--mode",
			"rpc",
		];
		// CWD doesn't apply locally for SSH — pi runs in the VM's $HOME.
		// Use user's HOME as the local cwd for the ssh process.
		spawnCwd = process.env.HOME || "/tmp";
	} else {
		spawnBin = PI_BIN;
		spawnArgs = ["--mode", "rpc"];
		spawnCwd = ws.cwd;
	}

	console.log(
		`→ spawning ${spawnBin} ${spawnArgs.join(" ")} [workspace: ${ws.name}]`,
	);
	setPiHealth(ws, false);
	ws.piProc = spawn(spawnBin, spawnArgs, {
		cwd: spawnCwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env },
	});

	console.log(`  pi PID: ${ws.piProc.pid}`);

	// Capture ws in closure for the event handlers
	const procWs = ws;

	procWs.piProc.on("error", (err) => {
		console.log(
			`  pi spawn error [${ws.name}]: ${err.message} code=${err.code} path=${err.path} spawnBin=${spawnBin}`,
		);
		console.log(
			`  [DEBUG] existsSync(spawnBin)=${existsSync(spawnBin)} spawnCwd=${spawnCwd}`,
		);
		setPiHealth(procWs, false);
		procWs.piConnected = false;
	});

	procWs.piProc.stdout.on("data", (chunk) => {
		procWs.lineBuffer += chunk.toString();
		const lines = procWs.lineBuffer.split("\n");
		procWs.lineBuffer = lines.pop();
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const data = JSON.parse(line);
				handleRpcEvent(procWs, data);
			} catch (e) {
				console.log("  pi stdout:", line.substring(0, 120));
			}
		}
	});

	procWs.piProc.stderr.on("data", (chunk) => {
		const text = chunk.toString().trim();
		if (text)
			console.log(`  pi stderr [${procWs.name}]:`, text.substring(0, 200));
	});

	procWs.piProc.on("error", (err) => {
		console.error(`  pi spawn error [${procWs.name}]:`, err.message);
		broadcast({
			type: "error",
			message: `Pi failed to start: ${err.message}. Click ↻ to retry.`,
			workspace: procWs.name,
		});
	});

	// Debug: log when stdout closes
	procWs.piProc.stdout.on("end", () => {
		console.log(`  [DEBUG] pi stdout ended [${procWs.name}]`);
	});

	procWs.piProc.stdin.on("error", (err) => {
		console.error(`  [DEBUG] pi stdin error [${procWs.name}]:`, err.message);
	});

	// Request initial state once pi is ready
	setTimeout(() => {
		if (procWs.piProc && !procWs.piProc.killed) {
			console.log(`  requesting initial state from pi [${procWs.name}]...`);
			setPiHealth(procWs, true);
			startPiHeartbeat(procWs);
			sendRpc(procWs, "get_commands", {});
			sendRpc(procWs, "get_state", {});
			sendRpc(procWs, "get_available_models", {});
		} else {
			setPiHealth(procWs, false);
			if (!procWs.restarting)
				broadcast({
					type: "error",
					message: "Pi exited immediately. Click Restart to retry.",
					workspace: procWs.name,
				});
		}
	}, 1500);

	procWs.piProc.on("close", (code, signal) => {
		console.log(
			`→ pi exited [${procWs.name}] (code ${code}, signal ${signal})`,
		);
		procWs.piProc = null;
		procWs.busy = false;
		setPiHealth(procWs, false);
		broadcast({
			type: "status",
			busy: false,
			connected: false,
			workspace: procWs.name,
		});
		setTimeout(() => {
			// Only auto-restart if this is still the active workspace
			if (!procWs.piProc && procWs === getActive()) ensurePi(procWs);
		}, 3000);
	});
}

function sendRpc(ws, command, params) {
	if (!ws.piProc || ws.piProc.killed) return;
	const id = `${++ws.requestId}`;
	const msg = JSON.stringify({ id, type: command, ...params }) + "\n";
	ws.piProc.stdin.write(msg);
}

function handleRpcEvent(ws, data) {
	// RPC responses (have id)
	if (data.id) {
		if (data.type === "response") {
			if (data.command === "prompt" && !data.success) {
				broadcast({ type: "error", message: data.error || "Prompt failed" });
				ws.busy = false;
				broadcast({ type: "status", busy: false, workspace: ws.name });
			}

			if (
				data.command === "get_messages" &&
				data.success &&
				data.data?.messages
			) {
				if (ws.historyLoadPending) {
					ws.historyLoadPending = false;
					broadcast({ type: "history", messages: data.data.messages });
				}
				const pending = ws.pendingRequests.get("export");
				if (pending) {
					pending.resolve(data.data.messages);
					ws.pendingRequests.delete("export");
				}
			}

			if (
				data.command === "get_commands" &&
				data.success &&
				data.data?.commands
			) {
				ws.cachedCommands = data.data.commands;
				broadcast({ type: "commands", commands: ws.cachedCommands });
			}

			if (data.command === "get_state" && data.success && data.data) {
				ws.currentSessionFile = data.data.sessionFile || null;
				ws.currentSessionId = data.data.sessionId || null;
				ws.currentModel = data.data.model || ws.currentModel;
				ws.currentThinkingLevel =
					data.data.thinkingLevel || ws.currentThinkingLevel;
				broadcast({
					type: "session_state",
					sessionFile: ws.currentSessionFile,
					sessionId: ws.currentSessionId,
					sessionName: data.data.sessionName,
					model: ws.currentModel,
					thinkingLevel: ws.currentThinkingLevel,
				});
			}

			if (data.command === "set_model" && data.success) {
				sendRpc(ws, "get_state", {});
			}
			if (data.command === "cycle_model" && data.success && data.data?.model) {
				ws.currentModel = data.data.model;
				broadcast({
					type: "model_state",
					model: ws.currentModel,
					thinkingLevel: ws.currentThinkingLevel,
				});
			}
			if (data.command === "set_thinking_level" && data.success) {
				sendRpc(ws, "get_state", {});
			}
			if (
				data.command === "cycle_thinking_level" &&
				data.success &&
				data.data?.level
			) {
				ws.currentThinkingLevel = data.data.level;
				broadcast({
					type: "model_state",
					model: ws.currentModel,
					thinkingLevel: ws.currentThinkingLevel,
				});
			}
			if (data.command === "get_session_stats" && data.success && data.data) {
				broadcast({ type: "session_stats", stats: data.data });
			}
			if (
				data.command === "get_available_models" &&
				data.success &&
				data.data?.models
			) {
				broadcast({ type: "available_models", models: data.data.models });
			}

			if (data.command === "switch_session" && data.success) {
				const cancelled = data.data?.cancelled;
				// Load messages for the newly switched session (or re-load if same session)
				ws.historyLoadPending = true;
				sendRpc(ws, "get_messages", {});
				sendRpc(ws, "get_state", {});
				if (!cancelled) broadcast({ type: "session_switched" });
				ws.pendingRequests.delete("switch_session_path");
			}

			if (
				data.command === "new_session" &&
				data.success &&
				!data.data?.cancelled
			) {
				// get_state already scheduled via handleClientMessage timeout
			}
		}
		return;
	}

	// RPC events (no id)
	switch (data.type) {
		case "agent_start":
			broadcast(data);
			break;

		case "agent_end":
			ws.busy = false;
			broadcast({ type: "status", busy: false, workspace: ws.name });
			broadcast(data);
			sendRpc(ws, "get_state", {});
			sendRpc(ws, "get_session_stats", {});
			break;

		case "message_start":
		case "message_update":
		case "message_end":
			broadcast(data);
			break;

		case "turn_start":
		case "turn_end":
			broadcast(data);
			break;

		case "tool_execution_start":
		case "tool_execution_update":
		case "tool_execution_end":
			broadcast(data);
			break;

		case "compaction_start":
		case "compaction_end":
			broadcast(data);
			break;

		default:
			broadcast(data);
	}
}

// ── Graceful shutdown ───────────────────────────────────────────────────
function shutdown() {
	console.log("→ shutting down");
	for (const ws of workspaces.values()) {
		clearIdleTimer(ws);
		if (ws.piHealthInterval) clearInterval(ws.piHealthInterval);
		if (ws.piProc && !ws.piProc.killed) ws.piProc.kill("SIGTERM");
	}
	wss.close();
	server.close();
	process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ── Boot ────────────────────────────────────────────────────────────────
if (workspaces.size === 1 && activeWorkspaceName === "default") {
	// Legacy single-workspace mode
	console.log(`  CWD:   ${CWD}`);
} else {
	console.log(`  Workspaces:`);
	for (const [name, ws] of workspaces) {
		const marker = name === activeWorkspaceName ? "→" : " ";
		const mode =
			ws.mode === "ssh" ? `ssh ${ws.sshUser}@${ws.sshHost}` : "local";
		console.log(
			`  ${marker} ${name}: ${ws.cwd} (${mode})${ws.context ? ` — ${ws.context}` : ""}`,
		);
	}
}
console.log(`  Port:  ${PORT}`);
ensurePi(getActive());
