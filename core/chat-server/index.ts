import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatSessionManager, type ChatSessionManagerOptions } from "./session.js";
import { handleSetupApply, serveSetupPage, shouldAutoApply, shouldRedirectToSetup } from "./setup.js";

export interface ChatServerOptions extends ChatSessionManagerOptions {
	/** Directory containing the pre-built frontend (index.html + assets). */
	staticDir: string;
	/** Path to ~/.nixpi/wizard-state/system-ready. */
	systemReadyFile: string;
	/** Path to the setup apply script. */
	applyScript: string;
	/** Optional path to a wizard prefill file that enables auto-apply. */
	prefillFile?: string;
}

export function createChatServer(opts: ChatServerOptions): http.Server {
	const sessions = new ChatSessionManager(opts);

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

		if (shouldRedirectToSetup(url.pathname, opts.systemReadyFile)) {
			res.writeHead(302, { Location: "/setup" }).end();
			return;
		}

		if (req.method === "GET" && url.pathname === "/setup") {
			serveSetupPage(res, {
				autoApply: opts.prefillFile ? shouldAutoApply(opts.prefillFile, opts.systemReadyFile) : false,
			});
			return;
		}

		if (req.method === "POST" && url.pathname === "/api/setup/apply") {
			await handleSetupApply(req, res, { applyScript: opts.applyScript });
			return;
		}

		// POST /chat — streaming NDJSON
		if (req.method === "POST" && url.pathname === "/chat") {
			let body = "";
			for await (const chunk of req) body += chunk;

			let parsed: { sessionId?: string; message?: string };
			try {
				parsed = JSON.parse(body) as { sessionId?: string; message?: string };
			} catch {
				res.writeHead(400).end(JSON.stringify({ error: "invalid JSON" }));
				return;
			}
			if (!parsed.sessionId || typeof parsed.sessionId !== "string") {
				res.writeHead(400).end(JSON.stringify({ error: "sessionId required" }));
				return;
			}
			if (!parsed.message || typeof parsed.message !== "string") {
				res.writeHead(400).end(JSON.stringify({ error: "message required" }));
				return;
			}

			res.writeHead(200, {
				"Content-Type": "application/x-ndjson",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});

			try {
				for await (const event of sessions.sendMessage(parsed.sessionId, parsed.message)) {
					res.write(`${JSON.stringify(event)}\n`);
				}
			} catch (err) {
				res.write(`${JSON.stringify({ type: "error", message: String(err) })}\n`);
			}
			res.end();
			return;
		}

		// DELETE /chat/:sessionId — reset session
		const deleteMatch = url.pathname.match(/^\/chat\/([^/]+)$/);
		if (req.method === "DELETE" && deleteMatch) {
			sessions.delete(deleteMatch[1]);
			res.writeHead(204).end();
			return;
		}

		// GET static files
		if (req.method === "GET") {
			const filePath = path.join(opts.staticDir, url.pathname === "/" ? "index.html" : url.pathname);
			// Prevent path traversal
			const root = opts.staticDir.endsWith(path.sep) ? opts.staticDir : opts.staticDir + path.sep;
			if (!filePath.startsWith(root)) {
				res.writeHead(403).end();
				return;
			}
			try {
				const data = fs.readFileSync(filePath);
				const ext = path.extname(filePath);
				const mime: Record<string, string> = {
					".html": "text/html",
					".js": "application/javascript",
					".css": "text/css",
					".json": "application/json",
					".ico": "image/x-icon",
				};
				res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
				res.end(data);
			} catch {
				res.writeHead(404).end("Not found");
			}
			return;
		}

		res.writeHead(405).end();
	});

	return server;
}

export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
	if (!argv1) {
		return false;
	}

	const modulePath = fileURLToPath(moduleUrl);

	try {
		return fs.realpathSync(argv1) === fs.realpathSync(modulePath);
	} catch {
		return path.resolve(argv1) === path.resolve(modulePath);
	}
}

// Entry point when run as a service.
if (isMainModule(process.argv[1], import.meta.url)) {
	const port = parseInt(process.env.NIXPI_CHAT_PORT ?? "8080", 10);
	const nixpiShareDir = process.env.NIXPI_SHARE_DIR ?? "/usr/local/share/nixpi";
	const piDir = process.env.PI_DIR ?? `${process.env.HOME}/.pi`;
	const primaryUser = process.env.NIXPI_PRIMARY_USER ?? "pi";
	const systemReadyFile =
		process.env.NIXPI_SYSTEM_READY_FILE ?? `/home/${primaryUser}/.nixpi/wizard-state/system-ready`;
	const applyScript = process.env.NIXPI_SETUP_APPLY_SCRIPT ?? "/run/current-system/sw/bin/nixpi-setup-apply";
	const prefillFile = process.env.NIXPI_SETUP_PREFILL_FILE ?? `/home/${primaryUser}/.nixpi/prefill.env`;
	const chatSessionsDir = `${piDir}/chat-sessions`;
	const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "frontend/dist");

	const server = createChatServer({
		nixpiShareDir,
		chatSessionsDir,
		idleTimeoutMs: parseInt(process.env.NIXPI_CHAT_IDLE_TIMEOUT ?? "1800", 10) * 1000,
		maxSessions: parseInt(process.env.NIXPI_CHAT_MAX_SESSIONS ?? "4", 10),
		staticDir,
		systemReadyFile,
		applyScript,
		prefillFile,
	});

	server.listen(port, "127.0.0.1", () => {
		console.log(`nixpi-chat listening on 127.0.0.1:${port}`);
	});
}
