import { ClientEvent, type MatrixClient, type MatrixEvent, MemoryStore, SyncState, createClient } from "matrix-js-sdk";
import type { MatrixBridge, MatrixIdentity, MatrixTextEvent } from "../contracts/matrix.js";
import { emitMatrixConnected, emitMatrixDisconnected, emitMatrixError } from "../metrics.js";
import { enforceMapLimit, pruneExpiredEntries } from "../ordered-cache.js";

interface ClientEntry {
	identity: MatrixIdentity;
	client: MatrixClient;
}

export interface MatrixJsSdkBridgeOptions {
	identities: readonly MatrixIdentity[];
	initialSyncLimit?: number;
	seenEventTtlMs?: number;
	maxSeenEventIds?: number;
}

const DEFAULT_SEEN_EVENT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SEEN_EVENT_IDS = 10_000;
const NOOP = () => {};

export class MatrixJsSdkBridge implements MatrixBridge {
	private readonly options: MatrixJsSdkBridgeOptions;
	private readonly clients = new Map<string, ClientEntry>();
	private readonly seenEventIds = new Map<string, number>();
	private onTextEventHandler: (identityId: string, event: MatrixTextEvent) => void = NOOP;

	constructor(options: MatrixJsSdkBridgeOptions) {
		this.options = options;
	}

	private get seenEventTtlMs(): number {
		return this.options.seenEventTtlMs ?? DEFAULT_SEEN_EVENT_TTL_MS;
	}

	private get maxSeenEventIds(): number {
		return this.options.maxSeenEventIds ?? DEFAULT_MAX_SEEN_EVENT_IDS;
	}

	onTextEvent(handler: (identityId: string, event: MatrixTextEvent) => void): void {
		this.onTextEventHandler = handler;
	}

	async start(): Promise<void> {
		for (const identity of this.options.identities) {
			const client = createClient({
				baseUrl: identity.homeserver,
				accessToken: identity.accessToken,
				userId: identity.userId,
				store: new MemoryStore({ localStorage: undefined }),
			});
			this.clients.set(identity.id, { identity, client });
			this.attachEventHandlers(identity, client);
			try {
				await this.startClient(client);
				emitMatrixConnected(identity.id);
			} catch (error) {
				emitMatrixError(identity.id, String(error));
				this.clients.delete(identity.id);
				client.stopClient();
				throw error;
			}
		}
	}

	stop(): void {
		for (const entry of this.clients.values()) {
			emitMatrixDisconnected(entry.identity.id);
			entry.client.stopClient();
		}
		this.clients.clear();
	}

	async sendText(identityId: string, roomId: string, text: string): Promise<void> {
		const entry = this.requireClient(identityId);
		await entry.client.sendHtmlMessage(roomId, text, renderMatrixHtml(text));
	}

	async setTyping(identityId: string, roomId: string, typing: boolean, timeoutMs = 30_000): Promise<void> {
		const entry = this.requireClient(identityId);
		await entry.client.sendTyping(roomId, typing, timeoutMs);
	}

	async getRoomAlias(identityId: string, roomId: string): Promise<string> {
		const entry = this.requireClient(identityId);
		const room = entry.client.getRoom(roomId);
		const canonicalAlias = room?.getCanonicalAlias();
		if (canonicalAlias) return canonicalAlias;

		const altAlias = room?.getAltAliases()[0];
		if (altAlias) return altAlias;

		try {
			const { aliases } = await entry.client.getLocalAliases(roomId);
			return aliases[0] ?? roomId;
		} catch {
			return roomId;
		}
	}

	private requireClient(identityId: string): ClientEntry {
		const entry = this.clients.get(identityId);
		if (!entry) throw new Error(`Unknown Matrix identity: ${identityId}`);
		return entry;
	}

	private attachEventHandlers(identity: MatrixIdentity, client: MatrixClient): void {
		client.on(ClientEvent.Event, (event: MatrixEvent) => {
			void this.handleMatrixEvent(identity, client, event);
		});
	}

	private async startClient(client: MatrixClient): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const onSync = (state: SyncState, _prevState: SyncState | null, data?: { error?: Error }) => {
				if (state === SyncState.Prepared || state === SyncState.Syncing) {
					client.off(ClientEvent.Sync, onSync);
					client.off(ClientEvent.SyncUnexpectedError, onUnexpectedError);
					resolve();
					return;
				}
				if (state === SyncState.Error) {
					client.off(ClientEvent.Sync, onSync);
					client.off(ClientEvent.SyncUnexpectedError, onUnexpectedError);
					reject(data?.error ?? new Error("Matrix client failed initial sync"));
				}
			};

			const onUnexpectedError = (error: Error) => {
				client.off(ClientEvent.Sync, onSync);
				client.off(ClientEvent.SyncUnexpectedError, onUnexpectedError);
				reject(error);
			};

			client.on(ClientEvent.Sync, onSync);
			client.on(ClientEvent.SyncUnexpectedError, onUnexpectedError);
			void client.startClient({
				initialSyncLimit: this.options.initialSyncLimit ?? 8,
			});
		});
	}

	private async handleMatrixEvent(identity: MatrixIdentity, client: MatrixClient, event: MatrixEvent): Promise<void> {
		if (await this.tryAutojoin(identity, client, event)) return;

		if (event.getType() !== "m.room.message") return;

		const roomId = event.getRoomId();
		const senderUserId = event.getSender();
		if (!roomId || !senderUserId || senderUserId === identity.userId) return;
		if (!/^@[a-zA-Z0-9._=\-/]+:[a-zA-Z0-9.-]+$/.test(senderUserId)) return;

		const content = event.getContent() as { msgtype?: string; body?: string };
		if (content.msgtype !== "m.text" || !content.body) return;

		const eventId = event.getId() ?? "unknown";
		const timestamp = event.getTs();
		this.pruneSeenEventIds(timestamp);
		if (this.seenEventIds.has(eventId)) return;
		this.seenEventIds.set(eventId, timestamp);

		this.onTextEventHandler(identity.id, {
			roomId,
			eventId,
			senderUserId,
			body: content.body,
			timestamp,
		});
	}

	private async tryAutojoin(identity: MatrixIdentity, client: MatrixClient, event: MatrixEvent): Promise<boolean> {
		if (!identity.autojoin) return false;
		if (event.getType() !== "m.room.member") return false;

		const rawEvent = event.event as { state_key?: string; content?: { membership?: string }; room_id?: string };
		if (rawEvent.state_key !== identity.userId) return false;
		if (rawEvent.content?.membership !== "invite") return false;
		if (!rawEvent.room_id) return false;

		await client.joinRoom(rawEvent.room_id);
		return true;
	}

	private pruneSeenEventIds(now: number): void {
		pruneExpiredEntries(this.seenEventIds, now, (timestamp) => timestamp, this.seenEventTtlMs);
		enforceMapLimit(this.seenEventIds, this.maxSeenEventIds - 1);
	}
}

// ---------------------------------------------------------------------------
// Markdown to HTML Rendering
// ---------------------------------------------------------------------------

interface LineParserState {
	lines: string[];
	index: number;
	parts: string[];
}

function renderMatrixHtml(text: string): string {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (!normalized) return "<p></p>";

	const state: LineParserState = {
		lines: normalized.split("\n"),
		index: 0,
		parts: [],
	};

	while (state.index < state.lines.length) {
		const line = state.lines[state.index] ?? "";
		if (!line.trim()) {
			state.index += 1;
			continue;
		}

		const parsed =
			tryParseCodeBlock(state, line) ??
			tryParseHeading(state, line) ??
			tryParseBlockquote(state, line) ??
			tryParseUnorderedList(state, line) ??
			tryParseOrderedList(state, line) ??
			parseParagraph(state);

		if (parsed) {
			state.parts.push(parsed);
		}
	}

	return state.parts.join("");
}

function tryParseCodeBlock(state: LineParserState, line: string): string | null {
	if (!line.startsWith("```")) return null;

	const fence = line.slice(3).trim();
	const codeLines: string[] = [];
	state.index += 1;

	while (state.index < state.lines.length && !(state.lines[state.index] ?? "").startsWith("```")) {
		codeLines.push(state.lines[state.index] ?? "");
		state.index += 1;
	}
	if (state.index < state.lines.length) state.index += 1;

	const classAttr = fence ? ` class="language-${escapeHtmlAttribute(fence)}"` : "";
	return `<pre><code${classAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
}

function tryParseHeading(state: LineParserState, line: string): string | null {
	const match = line.match(/^(#{1,6})\s+(.+)$/);
	if (!match) return null;

	const level = match[1]?.length ?? 1;
	const content = match[2] ?? "";
	state.index += 1;
	return `<h${level}>${renderInlineMarkdown(content)}</h${level}>`;
}

function tryParseBlockquote(state: LineParserState, line: string): string | null {
	if (!line.startsWith(">")) return null;

	const quoteLines: string[] = [];
	while (state.index < state.lines.length) {
		const current = state.lines[state.index] ?? "";
		if (!current.trim()) {
			state.index += 1;
			break;
		}
		if (!current.startsWith(">")) break;
		quoteLines.push(current.replace(/^>\s?/, ""));
		state.index += 1;
	}

	const paragraphs = quoteLines.map((entry) => `<p>${renderInlineMarkdown(entry)}</p>`).join("");
	return `<blockquote>${paragraphs}</blockquote>`;
}

function tryParseUnorderedList(state: LineParserState, line: string): string | null {
	const match = line.match(/^(\s*)[-*+]\s+(.+)$/);
	if (!match) return null;

	const items: string[] = [];
	while (state.index < state.lines.length) {
		const current = state.lines[state.index] ?? "";
		const itemMatch = current.match(/^(\s*)[-*+]\s+(.+)$/);
		if (!itemMatch) break;
		items.push(`<li>${renderInlineMarkdown(itemMatch[2] ?? "")}</li>`);
		state.index += 1;
	}
	return `<ul>${items.join("")}</ul>`;
}

function tryParseOrderedList(state: LineParserState, line: string): string | null {
	const match = line.match(/^\s*\d+[.)]\s+(.+)$/);
	if (!match) return null;

	const items: string[] = [];
	while (state.index < state.lines.length) {
		const current = state.lines[state.index] ?? "";
		const itemMatch = current.match(/^\s*\d+[.)]\s+(.+)$/);
		if (!itemMatch) break;
		items.push(`<li>${renderInlineMarkdown(itemMatch[1] ?? "")}</li>`);
		state.index += 1;
	}
	return `<ol>${items.join("")}</ol>`;
}

function isBlockStart(line: string): boolean {
	return (
		line.startsWith("```") ||
		line.startsWith(">") ||
		/^#{1,6}\s+/.test(line) ||
		/^(\s*)[-*+]\s+/.test(line) ||
		/^\s*\d+[.)]\s+/.test(line)
	);
}

function parseParagraph(state: LineParserState): string {
	const paragraphLines: string[] = [];
	while (state.index < state.lines.length) {
		const current = state.lines[state.index] ?? "";
		if (!current.trim()) {
			state.index += 1;
			break;
		}
		if (isBlockStart(current)) break;
		paragraphLines.push(current);
		state.index += 1;
	}
	return `<p>${renderInlineMarkdown(paragraphLines.join("\n"))}</p>`;
}

function renderInlineMarkdown(text: string): string {
	let html = escapeHtml(text);

	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
	html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
	html = html.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
	html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
	html = html.replace(/\n/g, "<br>");

	return html;
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value).replaceAll('"', "&quot;");
}
