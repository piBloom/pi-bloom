/**
 * Handler / business logic for bloom-audit.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { dayStamp, summarizeInput } from "../../lib/audit.js";
import { getBloomDir } from "../../lib/filesystem.js";
import { createLogger, truncate } from "../../lib/shared.js";
import type { AuditEntry } from "./types.js";

const log = createLogger("bloom-audit");

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Get the audit directory path. */
function auditDir(): string {
	return join(getBloomDir(), "audit");
}

/** Ensure the audit directory exists and return its path. */
export function ensureAuditDir(): string {
	const dir = auditDir();
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Append an audit entry to today's JSONL file. */
export function appendAudit(entry: AuditEntry): void {
	try {
		const file = join(ensureAuditDir(), `${dayStamp(new Date())}.jsonl`);
		appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf-8");
	} catch (err) {
		log.error("failed to append audit entry", { error: (err as Error).message });
	}
}

/** Remove audit files older than RETENTION_DAYS. */
export function rotateAudit(now = new Date()): void {
	const dir = ensureAuditDir();
	const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;

	for (const name of readdirSync(dir)) {
		if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
		const dayTs = Date.parse(`${name.slice(0, 10)}T00:00:00Z`);
		if (Number.isNaN(dayTs)) continue;
		if (dayTs < cutoff) {
			try {
				unlinkSync(join(dir, name));
			} catch (err) {
				log.warn("failed to remove old audit file", { file: name, error: (err as Error).message });
			}
		}
	}
}

/** Read audit entries from the last N days. */
export function readEntries(days: number): AuditEntry[] {
	const dir = auditDir();
	if (!existsSync(dir)) return [];

	const entries: AuditEntry[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const date = new Date(Date.now() - i * DAY_MS);
		const file = join(dir, `${dayStamp(date)}.jsonl`);
		if (!existsSync(file)) continue;

		try {
			const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const parsed = JSON.parse(line);
					if (isAuditEntry(parsed)) {
						entries.push(parsed);
					}
				} catch {
					// Skip malformed lines.
				}
			}
		} catch (err) {
			log.warn("failed to read audit file", { file, error: (err as Error).message });
		}
	}

	return entries;
}

function isAuditEntry(value: unknown): value is AuditEntry {
	if (!value || typeof value !== "object") return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.ts === "string" &&
		(entry.event === "tool_call" || entry.event === "tool_result") &&
		typeof entry.tool === "string" &&
		typeof entry.toolCallId === "string"
	);
}

/** Handle the audit_review tool call. */
export function handleAuditReview(params: { days?: number; limit?: number; tool?: string; include_inputs?: boolean }) {
	const days = Math.max(1, Math.min(30, Math.round(params.days ?? 1)));
	const limit = Math.max(1, Math.min(500, Math.round(params.limit ?? 50)));
	const byTool = params.tool?.trim();
	const includeInputs = params.include_inputs ?? false;

	let entries = readEntries(days);
	if (byTool) {
		entries = entries.filter((e) => e.tool === byTool);
	}
	entries = entries.slice(-limit);

	if (entries.length === 0) {
		return {
			content: [{ type: "text" as const, text: "No audit entries found for the selected range/filter." }],
			details: { days, limit, tool: byTool ?? null, count: 0 },
		};
	}

	return {
		content: [{ type: "text" as const, text: formatEntries(entries, includeInputs) }],
		details: {
			days,
			limit,
			tool: byTool ?? null,
			count: entries.length,
		},
	};
}

/** Format audit entries for display. */
export function formatEntries(entries: AuditEntry[], includeInputs: boolean): string {
	const lines: string[] = [];
	for (const e of entries) {
		const status = e.event === "tool_result" ? (e.isError ? "error" : "ok") : "call";
		lines.push(`- ${e.ts} ${e.tool} [${status}]`);
		if (includeInputs && e.event === "tool_call") {
			const input = summarizeInput(e.input);
			if (input) lines.push(`  input: ${input}`);
		}
	}
	return truncate(lines.join("\n"));
}
