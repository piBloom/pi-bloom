/** Shared utilities: text truncation, error formatting, and service-name guards. */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";
import { requestInteraction } from "./interactions.js";

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
		if (!requireUi) return null;
		const interaction = requestInteraction(ctx, {
			kind: "confirm",
			key: action,
			prompt: `Allow: ${action}?`,
		});
		if (!interaction) {
			return `Cannot perform "${action}" without interactive user confirmation.`;
		}
		if (interaction.state === "resolved") {
			return interaction.value === "approved" ? null : `User declined: ${action}`;
		}
		return interaction.prompt;
	}
	const confirmed = await ctx.ui.confirm("Confirm action", `Allow: ${action}?`);
	if (!confirmed) return `User declined: ${action}`;
	return null;
}

export async function requestSelection(
	ctx: ExtensionContext,
	key: string,
	title: string,
	options: string[],
	config?: { resumeMessage?: string },
): Promise<{ value: string | null; prompt?: string }> {
	if (ctx.hasUI) {
		const selected = await ctx.ui.select(title, options);
		return { value: selected ?? null };
	}

	const interaction = requestInteraction(ctx, {
		kind: "select",
		key,
		prompt: title,
		options,
		resumeMessage: config?.resumeMessage,
	});
	if (!interaction) {
		return { value: null, prompt: `Cannot complete "${title}" without interactive input.` };
	}
	if (interaction.state === "resolved") {
		return { value: interaction.value };
	}
	return { value: null, prompt: interaction.prompt };
}

export async function requestTextInput(
	ctx: ExtensionContext,
	key: string,
	title: string,
	config?: { placeholder?: string; resumeMessage?: string },
): Promise<{ value: string | null; prompt?: string }> {
	if (ctx.hasUI) {
		const entered = await ctx.ui.input(title, config?.placeholder);
		return { value: entered ?? null };
	}

	const interaction = requestInteraction(ctx, {
		kind: "input",
		key,
		prompt: config?.placeholder ? `${title}\nHint: ${config.placeholder}` : title,
		resumeMessage: config?.resumeMessage,
	});
	if (!interaction) {
		return { value: null, prompt: `Cannot complete "${title}" without interactive input.` };
	}
	if (interaction.state === "resolved") {
		return { value: interaction.value };
	}
	return { value: null, prompt: interaction.prompt };
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

/** Validate that a service/unit name matches `<prefix>-[a-z0-9-]+`. Returns error message or null. */
export function guardServiceName(name: string, prefix = "nixpi"): string | null {
	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^${escapedPrefix}-[a-z0-9][a-z0-9-]*$`);
	if (!pattern.test(name)) {
		return `Security error: name must match ${prefix}-[a-z0-9-]+, got "${name}"`;
	}
	return null;
}
