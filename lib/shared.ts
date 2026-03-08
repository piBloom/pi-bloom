import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";

/** Truncate text to 2000 lines / 50KB using Pi's truncateHead utility. */
export function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

/** Build a standardized Pi tool error response. */
export function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
}

/** Prompt the user for confirmation via UI. Returns null if confirmed, error message if declined or no UI. */
export async function requireConfirmation(
	ctx: ExtensionContext,
	action: string,
	options?: { requireUi?: boolean },
): Promise<string | null> {
	const requireUi = options?.requireUi ?? true;
	if (!ctx.hasUI) {
		return requireUi ? `Cannot perform "${action}" without interactive user confirmation.` : null;
	}
	const confirmed = await ctx.ui.confirm("Confirm action", `Allow: ${action}?`);
	if (!confirmed) return `User declined: ${action}`;
	return null;
}

/** Return current time as ISO 8601 string without milliseconds (e.g., `2026-03-06T12:00:00Z`). */
export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

type LogLevel = "debug" | "info" | "warn" | "error";

/** Create a structured JSON logger for a named component. Outputs to stdout/stderr with timestamp, level, component, and message. */
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

/** Validate that a service/unit name matches `bloom-[a-z0-9-]+`. Returns error message or null. */
export function guardBloom(name: string): string | null {
	if (!/^bloom-[a-z0-9][a-z0-9-]*$/.test(name)) {
		return `Security error: name must match bloom-[a-z0-9-]+, got "${name}"`;
	}
	return null;
}
