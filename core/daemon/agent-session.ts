import { join } from "node:path";
import { sanitizeRoomAlias } from "../lib/room-alias.js";
import type { AgentDefinition } from "./agent-registry.js";
import { PiRoomSession } from "./pi-room-session.js";
import type { SessionEvent } from "./session-events.js";
import type { BloomSessionLike } from "./session-like.js";

export interface AgentSessionOptions {
	roomId: string;
	roomAlias: string;
	agent: AgentDefinition;
	sessionBaseDir: string;
	idleTimeoutMs: number;
	onAgentEnd: (agentId: string, text: string) => void;
	onEvent: (agentId: string, event: SessionEvent) => void;
	onExit: (agentId: string, code: number | null) => void;
}

export class AgentSession implements BloomSessionLike {
	private readonly opts: AgentSessionOptions;
	private readonly session: PiRoomSession;
	private readonly sanitizedRoomAlias: string;

	constructor(opts: AgentSessionOptions) {
		this.opts = opts;
		this.sanitizedRoomAlias = sanitizeRoomAlias(opts.roomAlias);
		this.session = new PiRoomSession({
			roomId: opts.roomId,
			roomAlias: opts.roomAlias,
			sanitizedAlias: `${this.sanitizedRoomAlias}-${opts.agent.id}`,
			sessionDir: join(opts.sessionBaseDir, this.sanitizedRoomAlias, opts.agent.id),
			idleTimeoutMs: opts.idleTimeoutMs,
			onAgentEnd: (text) => opts.onAgentEnd(opts.agent.id, text),
			onEvent: (event) => opts.onEvent(opts.agent.id, event),
			onExit: (code) => opts.onExit(opts.agent.id, code),
		});
	}

	get alive(): boolean {
		return this.session.alive;
	}

	get isStreaming(): boolean {
		return false;
	}

	get agentId(): string {
		return this.opts.agent.id;
	}

	get sessionDir(): string {
		return join(this.opts.sessionBaseDir, this.sanitizedRoomAlias, this.opts.agent.id);
	}

	async spawn(): Promise<void> {
		await this.session.spawn();
	}

	async sendMessage(text: string): Promise<void> {
		await this.session.sendMessage(text);
	}

	dispose(): void {
		this.session.dispose();
	}
}
