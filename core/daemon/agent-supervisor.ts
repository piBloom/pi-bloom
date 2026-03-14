import { createLogger } from "../lib/shared.js";
import type { AgentDefinition } from "./agent-registry.js";
import { AgentSession, type AgentSessionOptions } from "./agent-session.js";
import { createRoomState } from "./room-state.js";
import { type RoomEnvelope, routeRoomEnvelope } from "./router.js";
import type { SessionEvent } from "./session-events.js";
import type { BloomSessionLike } from "./session-like.js";

const log = createLogger("agent-supervisor");
const TYPING_TIMEOUT_MS = 30_000;
const TYPING_REFRESH_MS = 20_000;
const TOTAL_REPLY_BUDGET = 4;

interface SequentialChainReply {
	agentId: string;
	text: string;
}

interface SequentialChain {
	key: string;
	roomId: string;
	rootEventId: string;
	originalMessage: string;
	remainingAgentIds: string[];
	replies: SequentialChainReply[];
}

export interface MatrixPoolLike {
	sendText(agentId: string, roomId: string, text: string): Promise<void>;
	setTyping(agentId: string, roomId: string, typing: boolean, timeoutMs?: number): Promise<void>;
	getRoomAlias(agentId: string, roomId: string): Promise<string>;
	stop(): void;
}

export interface AgentSupervisorOptions {
	agents: readonly AgentDefinition[];
	matrixPool: MatrixPoolLike;
	sessionBaseDir: string;
	idleTimeoutMs: number;
	createSession?: (opts: AgentSessionOptions) => BloomSessionLike;
}

export class AgentSupervisor {
	private readonly agents: readonly AgentDefinition[];
	private readonly matrixPool: MatrixPoolLike;
	private readonly sessionBaseDir: string;
	private readonly idleTimeoutMs: number;
	private readonly createSession: (opts: AgentSessionOptions) => BloomSessionLike;
	private readonly roomState = createRoomState();
	private readonly sessions = new Map<string, BloomSessionLike>();
	private readonly preambleSent = new Set<string>();
	private readonly typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
	private readonly sequentialChains = new Map<string, SequentialChain>();
	private readonly waitingChainsByRoomAgent = new Map<string, string[]>();
	private shuttingDown = false;

	constructor(options: AgentSupervisorOptions) {
		this.agents = options.agents;
		this.matrixPool = options.matrixPool;
		this.sessionBaseDir = options.sessionBaseDir;
		this.idleTimeoutMs = options.idleTimeoutMs;
		this.createSession = options.createSession ?? ((opts) => new AgentSession(opts));
	}

	async handleEnvelope(envelope: RoomEnvelope): Promise<void> {
		if (this.shuttingDown) return;
		const decision = routeRoomEnvelope(envelope, this.agents, this.roomState, {
			totalReplyBudget: TOTAL_REPLY_BUDGET,
		});
		if (decision.targets.length === 0) return;

		const [firstAgentId, ...remainingAgentIds] = decision.targets;
		if (!firstAgentId) return;

		if (remainingAgentIds.length > 0) {
			const chainKey = this.chainKey(envelope.roomId, envelope.eventId);
			const chain: SequentialChain = {
				key: chainKey,
				roomId: envelope.roomId,
				rootEventId: envelope.eventId,
				originalMessage: this.buildInitialMessage(envelope),
				remainingAgentIds: [...remainingAgentIds],
				replies: [],
			};
			this.sequentialChains.set(chainKey, chain);

			try {
				await this.dispatchMessageToAgent(envelope.roomId, firstAgentId, chain.originalMessage);
				this.enqueueWaitingChain(envelope.roomId, firstAgentId, chainKey);
			} catch (error) {
				this.sequentialChains.delete(chainKey);
				throw error;
			}
			return;
		}

		await this.dispatchMessageToAgent(envelope.roomId, firstAgentId, this.buildInitialMessage(envelope));
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		for (const interval of this.typingIntervals.values()) {
			clearInterval(interval);
		}
		this.typingIntervals.clear();
		this.sequentialChains.clear();
		this.waitingChainsByRoomAgent.clear();
		for (const session of this.sessions.values()) {
			session.dispose();
		}
		this.sessions.clear();
		this.matrixPool.stop();
	}

	private async dispatchMessageToAgent(roomId: string, agentId: string, message: string): Promise<void> {
		if (this.shuttingDown) return;
		this.startTyping(roomId, agentId);
		try {
			const agent = this.requireAgent(agentId);
			const alias = await this.matrixPool.getRoomAlias(agentId, roomId);
			const session = await this.getOrSpawnSession(roomId, alias, agent);
			const key = this.sessionKey(roomId, agentId);

			if (!this.preambleSent.has(key)) {
				await session.sendMessage(`${this.buildPreamble(agent, alias)}\n\n${message}`);
				this.preambleSent.add(key);
			} else {
				await session.sendMessage(message);
			}
		} catch (error) {
			this.stopTyping(roomId, agentId);
			throw error;
		}
	}

	private buildInitialMessage(envelope: RoomEnvelope): string {
		return `[matrix: ${envelope.senderUserId}] ${envelope.body}`;
	}

	private buildSequentialHandoffMessage(chain: SequentialChain, nextAgentId: string): string {
		const nextAgent = this.requireAgent(nextAgentId);
		const priorReplies = chain.replies
			.map(({ agentId, text }) => {
				const priorAgent = this.requireAgent(agentId);
				return [`${priorAgent.name} (${priorAgent.matrix.userId}) replied:`, text].join("\n");
			})
			.join("\n\n");

		return [
			"[system] This is a sequential multi-agent handoff.",
			"The original room message was:",
			chain.originalMessage,
			"",
			"Previous agent replies in order:",
			priorReplies,
			"",
			`Now respond as ${nextAgent.name} (${nextAgent.matrix.userId}).`,
			"Continue from the prior reply instead of starting independently.",
			"If the human asked for critique or follow-up, address the previous agent's output directly.",
		].join("\n");
	}

	private async handleAgentResponse(roomId: string, agentId: string, text: string): Promise<void> {
		if (this.shuttingDown) return;
		await this.matrixPool.sendText(agentId, roomId, text);
		if (this.shuttingDown) return;

		const chainKey = this.dequeueWaitingChain(roomId, agentId);
		if (!chainKey) return;

		const chain = this.sequentialChains.get(chainKey);
		if (!chain) return;

		chain.replies.push({ agentId, text });
		const nextAgentId = chain.remainingAgentIds.shift();
		if (!nextAgentId) {
			this.sequentialChains.delete(chainKey);
			return;
		}

		await this.dispatchMessageToAgent(roomId, nextAgentId, this.buildSequentialHandoffMessage(chain, nextAgentId));
		if (this.shuttingDown) return;
		this.enqueueWaitingChain(roomId, nextAgentId, chainKey);
	}

	private async getOrSpawnSession(
		roomId: string,
		roomAlias: string,
		agent: AgentDefinition,
	): Promise<BloomSessionLike> {
		const key = this.sessionKey(roomId, agent.id);
		const existing = this.sessions.get(key);
		if (existing?.alive) return existing;
		if (existing) this.sessions.delete(key);

		const session = this.createSession({
			roomId,
			roomAlias,
			agent,
			sessionBaseDir: this.sessionBaseDir,
			idleTimeoutMs: this.idleTimeoutMs,
			onAgentEnd: (finishedAgentId, text) => {
				void this.handleAgentResponse(roomId, finishedAgentId, text).catch((error) => {
					log.error("failed to handle agent response", {
						roomId,
						agentId: finishedAgentId,
						error: String(error),
					});
				});
			},
			onEvent: (eventAgentId, event) => {
				this.handleSessionEvent(roomId, eventAgentId, event);
			},
			onExit: (exitedAgentId, _code) => {
				const sessionKey = this.sessionKey(roomId, exitedAgentId);
				this.sessions.delete(sessionKey);
				this.preambleSent.delete(sessionKey);
				this.stopTyping(roomId, exitedAgentId);
			},
		});

		await session.spawn();
		this.sessions.set(key, session);
		return session;
	}

	private handleSessionEvent(roomId: string, agentId: string, event: SessionEvent): void {
		if (event.type === "agent_start") {
			this.startTyping(roomId, agentId);
		} else if (event.type === "agent_end") {
			this.stopTyping(roomId, agentId);
		}
	}

	private startTyping(roomId: string, agentId: string): void {
		const key = this.sessionKey(roomId, agentId);
		if (this.typingIntervals.has(key)) return;

		void this.matrixPool.setTyping(agentId, roomId, true, TYPING_TIMEOUT_MS);
		const interval = setInterval(() => {
			void this.matrixPool.setTyping(agentId, roomId, true, TYPING_TIMEOUT_MS);
		}, TYPING_REFRESH_MS);
		interval.unref();
		this.typingIntervals.set(key, interval);
	}

	private stopTyping(roomId: string, agentId: string): void {
		const key = this.sessionKey(roomId, agentId);
		const interval = this.typingIntervals.get(key);
		if (interval) {
			clearInterval(interval);
			this.typingIntervals.delete(key);
		}
		void this.matrixPool.setTyping(agentId, roomId, false, TYPING_TIMEOUT_MS);
	}

	private buildPreamble(agent: AgentDefinition, roomAlias: string): string {
		return [
			`[system] You are the Bloom agent "${agent.name}".`,
			`Your Matrix identity is ${agent.matrix.userId}.`,
			`You are participating in room ${roomAlias}.`,
			"Other Bloom agents may also be present.",
			"Respond only as yourself.",
			"Do not continue agent-to-agent back-and-forth unless explicitly addressed.",
			"Prioritize being helpful to the human.",
			"",
			agent.instructionsBody,
		].join("\n");
	}

	private requireAgent(agentId: string): AgentDefinition {
		const agent = this.agents.find((candidate) => candidate.id === agentId);
		if (!agent) throw new Error(`Unknown agent: ${agentId}`);
		return agent;
	}

	private sessionKey(roomId: string, agentId: string): string {
		return `${roomId}::${agentId}`;
	}

	private chainKey(roomId: string, rootEventId: string): string {
		return `${roomId}::${rootEventId}`;
	}

	private roomAgentKey(roomId: string, agentId: string): string {
		return `${roomId}::${agentId}`;
	}

	private enqueueWaitingChain(roomId: string, agentId: string, chainKey: string): void {
		const key = this.roomAgentKey(roomId, agentId);
		const queue = this.waitingChainsByRoomAgent.get(key) ?? [];
		queue.push(chainKey);
		this.waitingChainsByRoomAgent.set(key, queue);
	}

	private dequeueWaitingChain(roomId: string, agentId: string): string | undefined {
		const key = this.roomAgentKey(roomId, agentId);
		const queue = this.waitingChainsByRoomAgent.get(key);
		if (!queue || queue.length === 0) return undefined;
		const chainKey = queue.shift();
		if (queue.length === 0) {
			this.waitingChainsByRoomAgent.delete(key);
		} else {
			this.waitingChainsByRoomAgent.set(key, queue);
		}
		return chainKey;
	}
}
