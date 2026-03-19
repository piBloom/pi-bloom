import { ClientEvent, createClient, type MatrixClient, type MatrixEvent, MemoryStore, SyncState } from "matrix-js-sdk";
import { renderMatrixHtml } from "../../lib/matrix-format.js";
import type { MatrixBridge, MatrixIdentity, MatrixTextEvent } from "../contracts/matrix.js";
import { emitMatrixConnected, emitMatrixDisconnected, emitMatrixError } from "../metrics.js";
import { enforceMapLimit, pruneExpiredEntries } from "../ordered-cache.js";

// ---------------------------------------------------------------------------
// Type guards for Matrix event content
// ---------------------------------------------------------------------------

interface TextMessageContent {
	msgtype: "m.text";
	body: string;
}

interface MemberEventContent {
	membership?: string;
}

interface RawMemberEvent {
	state_key?: string;
	content?: MemberEventContent;
	room_id?: string;
}

function isTextMessageContent(content: unknown): content is TextMessageContent {
	if (!content || typeof content !== "object") return false;
	const c = content as Record<string, unknown>;
	return c.msgtype === "m.text" && typeof c.body === "string";
}

function isRawMemberEvent(event: unknown): event is RawMemberEvent {
	if (!event || typeof event !== "object") return false;
	// We only check for the fields we need; partial validation is acceptable here
	return true;
}

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

		const content = event.getContent();
		if (!isTextMessageContent(content)) return;

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

		const rawEvent = event.event;
		if (!isRawMemberEvent(rawEvent)) return false;
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
