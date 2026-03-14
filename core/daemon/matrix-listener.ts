/**
 * Matrix listener — connects to homeserver via matrix-bot-sdk and routes messages.
 */
import { readFileSync } from "node:fs";
import type { MatrixClient } from "matrix-bot-sdk";
import type { MatrixCredentials } from "../lib/matrix.js";
import { createLogger } from "../lib/shared.js";
import { createMatrixClient } from "./matrix-client.js";

const log = createLogger("matrix-listener");

export interface IncomingMessage {
	sender: string;
	body: string;
	eventId: string;
}

export interface MatrixListenerOptions {
	credentialsPath: string;
	storagePath: string;
	onMessage: (roomId: string, message: IncomingMessage) => void;
}

export class MatrixListener {
	private client: MatrixClient | null = null;
	private botUserId: string | null = null;
	private readonly options: MatrixListenerOptions;

	constructor(options: MatrixListenerOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		const creds = this.loadCredentials();
		if (!creds) {
			throw new Error(`No credentials at ${this.options.credentialsPath}`);
		}

		this.client = createMatrixClient({
			homeserver: creds.homeserver,
			accessToken: creds.botAccessToken,
			storagePath: this.options.storagePath,
			autojoin: true,
		});
		this.botUserId = creds.botUserId;
		this.client.on("room.message", (roomId: string, event: Record<string, unknown>) => {
			void this.handleEvent(roomId, event);
		});

		await this.client.start();
		log.info("connected to Matrix", { userId: this.botUserId, homeserver: creds.homeserver });
	}

	stop(): void {
		if (this.client) {
			this.client.stop();
			log.info("disconnected from Matrix");
			this.client = null;
		}
	}

	async sendText(roomId: string, text: string): Promise<void> {
		if (!this.client) throw new Error("Matrix client not started");
		await this.client.sendText(roomId, text);
	}

	async setTyping(roomId: string, typing: boolean, timeoutMs = 30_000): Promise<void> {
		if (!this.client) throw new Error("Matrix client not started");
		await this.client.setTyping(roomId, typing, timeoutMs);
	}

	async getRoomAlias(roomId: string): Promise<string> {
		if (!this.client) return roomId;
		try {
			const aliases = await this.client.getPublishedAlias(roomId);
			return aliases ?? roomId;
		} catch {
			return roomId;
		}
	}

	private loadCredentials(): MatrixCredentials | null {
		try {
			return JSON.parse(readFileSync(this.options.credentialsPath, "utf-8")) as MatrixCredentials;
		} catch {
			return null;
		}
	}

	private async handleEvent(roomId: string, event: Record<string, unknown>): Promise<void> {
		const sender = event.sender as string | undefined;
		if (!sender || sender === this.botUserId) return;

		// Validate Matrix user ID format to prevent prompt injection via crafted sender
		if (!/^@[a-zA-Z0-9._=\-/]+:[a-zA-Z0-9.-]+$/.test(sender)) {
			log.warn("ignoring event with invalid sender format", { roomId, sender });
			return;
		}

		const content = event.content as Record<string, unknown> | undefined;
		if (!content || content.msgtype !== "m.text") return;

		const body = content.body as string | undefined;
		if (!body) return;

		const eventId = (event.event_id as string | undefined) ?? "unknown";

		log.info("received message", { roomId, sender, eventId });

		this.options.onMessage(roomId, { sender, body, eventId });
	}
}
