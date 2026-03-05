import os from "node:os";
import path from "node:path";
import { truncateHead } from "@mariozechner/pi-coding-agent";

export interface ParsedFrontmatter<T> {
	attributes: T;
	body: string;
	bodyBegin: number;
	frontmatter: string;
}

export function getGardenDir(): string {
	return process.env._BLOOM_GARDEN_RESOLVED ?? process.env.BLOOM_GARDEN_DIR ?? path.join(os.homedir(), "Garden");
}

export function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

export function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
}

export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
	const lines: string[] = ["---"];
	for (const [key, val] of Object.entries(data)) {
		if (Array.isArray(val)) {
			lines.push(`${key}: ${val.join(", ")}`);
		} else {
			lines.push(`${key}: ${val}`);
		}
	}
	lines.push("---");
	return `${lines.join("\n")}\n${content}`;
}

export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	str: string,
): ParsedFrontmatter<T> {
	if (!str.startsWith("---\n")) {
		return {
			attributes: {} as T,
			body: str,
			bodyBegin: 1,
			frontmatter: "",
		};
	}

	const end = str.indexOf("\n---\n", 4);
	if (end === -1) {
		return {
			attributes: {} as T,
			body: str,
			bodyBegin: 1,
			frontmatter: "",
		};
	}

	const frontmatter = str.slice(4, end);
	const body = str.slice(end + 5);
	const attributes: Record<string, unknown> = {};

	let currentArrayKey: string | null = null;
	let currentArrayValues: string[] = [];
	const flushArray = () => {
		if (currentArrayKey) {
			attributes[currentArrayKey] = currentArrayValues;
			currentArrayKey = null;
			currentArrayValues = [];
		}
	};

	for (const line of frontmatter.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		if (line.match(/^\s*-\s+/) && currentArrayKey) {
			const item = line.replace(/^\s*-\s+/, "").trim();
			if (item) currentArrayValues.push(item);
			continue;
		}

		flushArray();

		const colon = line.indexOf(":");
		if (colon === -1) continue;

		const key = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		if (!key) continue;

		if (val === "") {
			currentArrayKey = key;
			continue;
		}

		if (val.includes(",")) {
			attributes[key] = val
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		} else {
			attributes[key] = val;
		}
	}

	flushArray();

	const bodyBegin = frontmatter.split("\n").length + 3;
	return {
		attributes: attributes as T,
		body,
		bodyBegin,
		frontmatter,
	};
}

export const PARA_DIRS = ["Inbox", "Projects", "Areas", "Resources", "Archive"];

type LogLevel = "debug" | "info" | "warn" | "error";

export function createLogger(component: string) {
	function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
		const entry: Record<string, unknown> = {
			ts: new Date().toISOString(),
			level,
			component,
			msg,
			...extra,
		};
		const line = JSON.stringify(entry);
		if (level === "error") {
			console.error(line);
		} else if (level === "warn") {
			console.warn(line);
		} else {
			console.log(line);
		}
	}

	return {
		debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
		info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
		warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
		error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
	};
}
