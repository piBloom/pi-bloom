/**
 * Pure utility functions with no side effects.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// --- Moved from extension-tools.ts ---

export type RegisteredExtensionTool = Parameters<ExtensionAPI["registerTool"]>[0];
export const EmptyToolParams = Type.Object({});

export function textToolResult(text: string, details: Record<string, unknown> = {}, isError?: boolean) {
	return {
		content: [{ type: "text" as const, text }],
		details,
		...(isError !== undefined ? { isError } : {}),
	};
}

export function errorResult(message: string) {
	return textToolResult(message, {}, true);
}

export function registerTools(pi: ExtensionAPI, tools: readonly RegisteredExtensionTool[]): void {
	for (const tool of tools) {
		pi.registerTool(tool);
	}
}
