import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

function getSessionBaseDir() {
	return join(process.env.HOME || "", ".pi", "agent", "sessions");
}

function getCwdKey(cwd) {
	return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

function getSessionDir(ws) {
	return join(getSessionBaseDir(), getCwdKey(ws.cwd));
}

export function parseSessions(ws) {
	const sessionDir = getSessionDir(ws);

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

export function parseArchivedSessions(ws) {
	const archiveDir = join(getSessionDir(ws), "archived");
	if (!existsSync(archiveDir)) return [];

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
									? (c.find((b) => b.type === "text")?.text || "").slice(0, 80)
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
	return sessions;
}

function validateSessionFile(file) {
	if (!file || !file.endsWith(".jsonl")) {
		const error = new Error("Invalid file");
		error.statusCode = 400;
		throw error;
	}
	const sessionBaseDir = getSessionBaseDir();
	if (!file.startsWith(sessionBaseDir)) {
		const error = new Error("Forbidden");
		error.statusCode = 403;
		throw error;
	}
}

export function restoreSession(file) {
	validateSessionFile(file);
	const dest = join(dirname(file), "..", basename(file));
	renameSync(file, dest);
	return dest;
}

export function archiveSession(file) {
	validateSessionFile(file);
	const archiveDir = join(dirname(file), "archived");
	if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
	const dest = join(archiveDir, basename(file));
	renameSync(file, dest);
	return dest;
}

export function deleteSession(file) {
	validateSessionFile(file);
	unlinkSync(file);
}
