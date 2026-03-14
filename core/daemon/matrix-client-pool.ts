import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MatrixClient } from "matrix-bot-sdk";
import type { AgentDefinition } from "./agent-registry.js";
import { createMatrixClient } from "./matrix-client.js";
import { classifySender, extractMentions, type RoomEnvelope } from "./router.js";

interface AgentMatrixCredentials {
	homeserver: string;
	userId: string;
	accessToken: string;
	password: string;
	username: string;
}

export interface MatrixClientPoolOptions {
	agents: readonly AgentDefinition[];
	credentialsDir: string;
	storageDir: string;
	onEvent: (event: RoomEnvelope) => void;
}

interface AgentClientEntry {
	agent: AgentDefinition;
	credentials: AgentMatrixCredentials;
	client: MatrixClient;
}

const SEEN_EVENT_TTL_MS = 10 * 60 * 1000;
const MAX_SEEN_EVENT_IDS = 10_000;

export class MatrixClientPool {
	private readonly options: MatrixClientPoolOptions;
	private readonly clients = new Map<string, AgentClientEntry>();
	private readonly seenEventIds = new Map<string, number>();

	constructor(options: MatrixClientPoolOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		mkdirSync(this.options.storageDir, { recursive: true });

		for (const agent of this.options.agents) {
			const credentials = this.loadCredentials(agent.id);
			const storagePath = join(this.options.storageDir, `${agent.id}.json`);
			const client = createMatrixClient({
				homeserver: credentials.homeserver,
				accessToken: credentials.accessToken,
				storagePath,
				autojoin: agent.matrix.autojoin,
			});
			client.on("room.message", (roomId: string, event: Record<string, unknown>) => {
				void this.handleEvent(agent, credentials.userId, roomId, event);
			});
			await client.start();
			this.clients.set(agent.id, { agent, credentials, client });
		}
	}

	stop(): void {
		for (const entry of this.clients.values()) {
			entry.client.stop();
		}
		this.clients.clear();
	}

	async sendText(agentId: string, roomId: string, text: string): Promise<void> {
		const entry = this.requireClient(agentId);
		await entry.client.sendText(roomId, text);
	}

	async setTyping(agentId: string, roomId: string, typing: boolean, timeoutMs = 30_000): Promise<void> {
		const entry = this.requireClient(agentId);
		await entry.client.setTyping(roomId, typing, timeoutMs);
	}

	async getRoomAlias(agentId: string, roomId: string): Promise<string> {
		const entry = this.requireClient(agentId);
		try {
			const alias = await entry.client.getPublishedAlias(roomId);
			return alias ?? roomId;
		} catch {
			return roomId;
		}
	}

	private requireClient(agentId: string): AgentClientEntry {
		const entry = this.clients.get(agentId);
		if (!entry) throw new Error(`Unknown Matrix agent: ${agentId}`);
		return entry;
	}

	private loadCredentials(agentId: string): AgentMatrixCredentials {
		const path = join(this.options.credentialsDir, `${agentId}.json`);
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as AgentMatrixCredentials;
		} catch {
			throw new Error(`No Matrix credentials at ${path}`);
		}
	}

	private async handleEvent(
		_agent: AgentDefinition,
		selfUserId: string,
		roomId: string,
		event: Record<string, unknown>,
	): Promise<void> {
		const senderUserId = event.sender as string | undefined;
		if (!senderUserId || senderUserId === selfUserId) return;
		if (!/^@[a-zA-Z0-9._=\-/]+:[a-zA-Z0-9.-]+$/.test(senderUserId)) return;

		const content = event.content as Record<string, unknown> | undefined;
		if (!content || content.msgtype !== "m.text") return;
		const body = content.body as string | undefined;
		if (!body) return;

		const eventId = (event.event_id as string | undefined) ?? "unknown";
		const now = typeof event.origin_server_ts === "number" ? event.origin_server_ts : Date.now();
		this.pruneSeenEventIds(now);
		if (this.seenEventIds.has(eventId)) return;
		this.seenEventIds.set(eventId, now);

		const senderInfo = classifySender(senderUserId, "", this.options.agents);
		if (senderInfo.senderKind === "self") return;

		this.options.onEvent({
			roomId,
			eventId,
			senderUserId,
			body,
			senderKind: senderInfo.senderKind,
			...(senderInfo.senderAgentId ? { senderAgentId: senderInfo.senderAgentId } : {}),
			mentions: extractMentions(body, this.options.agents),
			timestamp: now,
		});
	}

	private pruneSeenEventIds(now: number): void {
		for (const [eventId, timestamp] of this.seenEventIds) {
			if (now - timestamp > SEEN_EVENT_TTL_MS) {
				this.seenEventIds.delete(eventId);
			}
		}
		while (this.seenEventIds.size >= MAX_SEEN_EVENT_IDS) {
			const oldest = this.seenEventIds.keys().next().value;
			if (!oldest) break;
			this.seenEventIds.delete(oldest);
		}
	}
}
