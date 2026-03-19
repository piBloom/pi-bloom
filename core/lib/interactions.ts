import fs from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export type InteractionKind = "confirm" | "select" | "input";
export type InteractionStatus = "pending" | "resolved" | "consumed";

export interface InteractionRecord {
	token: string;
	kind: InteractionKind;
	key: string;
	prompt: string;
	status: InteractionStatus;
	resolution?: string;
	options?: string[];
	resumeMessage?: string;
	createdAt: string;
	updatedAt: string;
}

interface InteractionStore {
	records: InteractionRecord[];
}

export interface ResolvedInteractionReply {
	record: InteractionRecord;
	value: string;
	ambiguous?: boolean;
}

const InteractionRecordSchema = Type.Object({
	token: Type.String(),
	kind: Type.Union([Type.Literal("confirm"), Type.Literal("select"), Type.Literal("input")]),
	key: Type.String(),
	prompt: Type.String(),
	status: Type.Union([Type.Literal("pending"), Type.Literal("resolved"), Type.Literal("consumed")]),
	resolution: Type.Optional(Type.String()),
	options: Type.Optional(Type.Array(Type.String())),
	resumeMessage: Type.Optional(Type.String()),
	createdAt: Type.String(),
	updatedAt: Type.String(),
});

const InteractionStoreSchema = Type.Object({
	records: Type.Array(InteractionRecordSchema),
});

const STORE_SUFFIX = ".bloom-interactions.json";
const MAX_RECORDS = 32;

function nowIso(): string {
	return new Date().toISOString();
}

function generateToken(): string {
	return Math.random().toString(36).slice(2, 8);
}

function getStorePath(ctx: ExtensionContext): string | null {
	const sessionManager = ctx.sessionManager;
	if (!sessionManager) return null;

	const sessionFile = sessionManager.getSessionFile();
	if (sessionFile) return `${sessionFile}${STORE_SUFFIX}`;

	const sessionDir = sessionManager.getSessionDir();
	const sessionId = sessionManager.getSessionId();
	if (!sessionDir || !sessionId) return null;
	return path.join(sessionDir, `${sessionId}${STORE_SUFFIX}`);
}

function loadStore(storePath: string): InteractionStore {
	try {
		return Value.Parse(InteractionStoreSchema, JSON.parse(fs.readFileSync(storePath, "utf-8")));
	} catch {
		return { records: [] };
	}
}

function saveStore(storePath: string, store: InteractionStore): void {
	fs.mkdirSync(path.dirname(storePath), { recursive: true });
	const trimmed = store.records.slice(-MAX_RECORDS);
	fs.writeFileSync(storePath, JSON.stringify({ records: trimmed }, null, 2));
}

function getPendingRecords(store: InteractionStore): InteractionRecord[] {
	return store.records.filter((entry) => entry.status === "pending");
}

function buildConfirmPrompt(record: InteractionRecord): string {
	return `Confirmation required for "${record.key}". Reply here with "confirm ${record.token}" to approve or "deny ${record.token}" to cancel.`;
}

function buildSelectPrompt(record: InteractionRecord): string {
	const options = record.options ?? [];
	const lines = [
		`${record.prompt}`,
		"",
		...options.map((option, index) => `${index + 1}. ${option}`),
		"",
		`Reply with the number or exact option text, for example "1 ${record.token}" or "${options[0] ?? ""} ${record.token}".`,
	];
	return lines.join("\n");
}

function buildInputPrompt(record: InteractionRecord): string {
	return `${record.prompt}\n\nReply with your answer followed by ${record.token} if needed to disambiguate.`;
}

function buildPrompt(record: InteractionRecord): string {
	switch (record.kind) {
		case "confirm":
			return buildConfirmPrompt(record);
		case "select":
			return buildSelectPrompt(record);
		case "input":
			return buildInputPrompt(record);
	}
}

function findLatestMatchingPending(
	store: InteractionStore,
	kind: InteractionKind,
	key: string,
): InteractionRecord | undefined {
	return [...store.records]
		.reverse()
		.find((entry) => entry.kind === kind && entry.key === key && entry.status === "pending");
}

function markResolved(store: InteractionStore, token: string, value: string): InteractionRecord | null {
	const record = store.records.find((entry) => entry.token === token);
	if (!record) return null;
	record.status = "resolved";
	record.resolution = value;
	record.updatedAt = nowIso();
	return record;
}

function markConsumed(record: InteractionRecord): void {
	record.status = "consumed";
	record.updatedAt = nowIso();
}

function normalizeReplyText(text: string, token?: string): string {
	const trimmed = text.trim();
	if (!token) return trimmed;
	return trimmed
		.replace(new RegExp(`\\s+${token}$`, "i"), "")
		.replace(new RegExp(`^${token}\\s+`, "i"), "")
		.trim();
}

function parseConfirmValue(text: string): "approved" | "denied" | null {
	const normalized = text.trim().toLowerCase();
	if (["confirm", "approve", "yes"].includes(normalized)) return "approved";
	if (["deny", "decline", "no"].includes(normalized)) return "denied";
	return null;
}

function parseSelectValue(text: string, options: string[]): string | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (/^\d+$/.test(trimmed)) {
		const index = Number(trimmed) - 1;
		return options[index] ?? null;
	}

	const lower = trimmed.toLowerCase();
	const exact = options.find((option) => option.toLowerCase() === lower);
	return exact ?? null;
}

function parseInputValue(text: string): string | null {
	const trimmed = text.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function extractTargetToken(text: string, pending: InteractionRecord[]): string | undefined {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return undefined;
	const pendingTokens = new Set(pending.map((entry) => entry.token.toLowerCase()));
	const first = words[0]?.toLowerCase();
	const last = words[words.length - 1]?.toLowerCase();
	if (first && pendingTokens.has(first)) return first;
	if (last && pendingTokens.has(last)) return last;
	return undefined;
}

function parseValue(record: InteractionRecord, text: string): string | null {
	switch (record.kind) {
		case "confirm":
			return parseConfirmValue(text);
		case "select":
			return parseSelectValue(text, record.options ?? []);
		case "input":
			return parseInputValue(text);
	}
}

export function requestInteraction(
	ctx: ExtensionContext,
	request: {
		kind: InteractionKind;
		key: string;
		prompt: string;
		options?: string[];
		resumeMessage?: string;
	},
): { state: "resolved"; value: string } | { state: "pending"; record: InteractionRecord; prompt: string } | null {
	const storePath = getStorePath(ctx);
	if (!storePath) return null;

	const store = loadStore(storePath);
	const resolved = [...store.records]
		.reverse()
		.find((entry) => entry.kind === request.kind && entry.key === request.key && entry.status === "resolved");
	if (resolved?.resolution) {
		const value = resolved.resolution;
		markConsumed(resolved);
		saveStore(storePath, store);
		return { state: "resolved", value };
	}

	const existing = findLatestMatchingPending(store, request.kind, request.key);
	if (existing) {
		return { state: "pending", record: existing, prompt: buildPrompt(existing) };
	}

	const ts = nowIso();
	const record: InteractionRecord = {
		token: generateToken(),
		kind: request.kind,
		key: request.key,
		prompt: request.prompt,
		status: "pending",
		...(request.options ? { options: request.options } : {}),
		...(request.resumeMessage ? { resumeMessage: request.resumeMessage } : {}),
		createdAt: ts,
		updatedAt: ts,
	};
	store.records.push(record);
	saveStore(storePath, store);
	return { state: "pending", record, prompt: buildPrompt(record) };
}

export function resolveInteractionReply(ctx: ExtensionContext, text: string): ResolvedInteractionReply | null {
	const storePath = getStorePath(ctx);
	if (!storePath) return null;

	const store = loadStore(storePath);
	const pending = getPendingRecords(store);
	if (pending.length === 0) return null;

	const explicitToken = extractTargetToken(text, pending);
	let record: InteractionRecord | undefined;
	let ambiguous = false;
	if (explicitToken) {
		record = pending.find((entry) => entry.token === explicitToken);
	} else if (pending.length === 1) {
		record = pending[0];
	} else {
		record = pending[pending.length - 1];
		ambiguous = true;
	}
	if (!record) return null;

	const normalizedReply = normalizeReplyText(text, record.token);
	const value = parseValue(record, normalizedReply);
	if (!value) return null;

	const resolved = markResolved(store, record.token, value);
	if (!resolved) return null;
	saveStore(storePath, store);
	return { record: resolved, value, ...(ambiguous ? { ambiguous: true } : {}) };
}

export function formatResumeMessage(record: InteractionRecord, value: string): string {
	const template = record.resumeMessage;
	if (template) {
		return template.replaceAll("{{value}}", value).replaceAll("{{token}}", record.token);
	}

	if (record.kind === "confirm") {
		return `The user ${value === "approved" ? "approved" : "denied"} confirmation ${record.token} for "${record.key}". Resume the blocked task if appropriate.`;
	}
	if (record.kind === "select") {
		return `The user selected "${value}" for "${record.key}". Continue the requested workflow using that choice.`;
	}
	return `The user replied "${value}" for "${record.key}". Continue the requested workflow using that input.`;
}

export function getPendingInteractions(ctx: ExtensionContext): InteractionRecord[] {
	const storePath = getStorePath(ctx);
	if (!storePath) return [];
	return getPendingRecords(loadStore(storePath));
}
