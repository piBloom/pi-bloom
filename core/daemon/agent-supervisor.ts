import { join } from "node:path";
import { sanitizeRoomAlias } from "../lib/room-alias.js";
import { createLogger } from "../lib/shared.js";
import type { AgentDefinition } from "./agent-registry.js";
import type { DaemonConfig } from "./config.js";
import type { BloomSessionLike, SessionEvent } from "./contracts/session.js";
import {
	emitMessageBlocked,
	emitMessageRouted,
	emitProactiveJobCompleted,
	emitProactiveJobFailed,
	emitProactiveJobStarted,
	emitSessionExit,
	emitSessionSpawned,
} from "./metrics.js";
import { createRoomState } from "./room-state.js";
import { type RoomEnvelope, routeRoomEnvelope } from "./router.js";
import { PiRoomSession, type PiRoomSessionOptions } from "./runtime/pi-room-session.js";
import type { TriggeredJob } from "./scheduler.js";

const log = createLogger("agent-supervisor");

export interface MatrixBridgeLike {
	sendText(agentId: string, roomId: string, text: string): Promise<void>;
	setTyping(agentId: string, roomId: string, typing: boolean, timeoutMs?: number): Promise<void>;
	getRoomAlias(agentId: string, roomId: string): Promise<string>;
	stop(): void;
}

export interface AgentSupervisorOptions {
	agents: readonly AgentDefinition[];
	matrixBridge?: MatrixBridgeLike;
	sessionBaseDir: string;
	idleTimeoutMs: number;
	createSession?: (opts: AgentSessionOptions) => BloomSessionLike;
	config?: DaemonConfig;
}

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

interface PendingProactiveJob {
	jobId: string;
	kind: TriggeredJob["kind"];
	quietIfNoop: boolean;
	noOpToken?: string;
}

export class AgentSupervisor {
	private readonly agents: readonly AgentDefinition[];
	private readonly matrixBridge: MatrixBridgeLike;
	private readonly sessionBaseDir: string;
	private readonly idleTimeoutMs: number;
	private readonly config: DaemonConfig;
	private readonly createSession: (opts: AgentSessionOptions) => BloomSessionLike;
	private readonly roomState: ReturnType<typeof createRoomState>;
	private readonly pendingProactiveJobs = new Map<string, PendingProactiveJob[]>();
	private readonly sessions = new Map<string, BloomSessionLike>();
	private readonly preambleSent = new Set<string>();
	private readonly typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
	private shuttingDown = false;

	constructor(options: AgentSupervisorOptions) {
		this.agents = options.agents;
		this.matrixBridge = options.matrixBridge ?? missingMatrixBridge();
		this.sessionBaseDir = options.sessionBaseDir;
		this.idleTimeoutMs = options.idleTimeoutMs;
		this.config = options.config ?? getDefaultConfig();
		this.roomState = createRoomState({
			processedEventTtlMs: this.config.processedEventTtlMs,
			rootReplyTtlMs: this.config.rootReplyTtlMs,
			roomAgentTtlMs: this.config.roomAgentTtlMs,
			maxProcessedEvents: this.config.maxProcessedEvents,
			maxRootReplies: this.config.maxRootReplies,
			maxRoomAgentEntries: this.config.maxRoomAgentEntries,
		});
		this.createSession = options.createSession ?? ((opts) => new PiRoomSession(buildPiRoomSessionOptions(opts)));
	}

	async handleEnvelope(envelope: RoomEnvelope): Promise<void> {
		if (this.shuttingDown) return;
		const startTime = Date.now();
		const decision = routeRoomEnvelope(envelope, this.agents, this.roomState, {
			totalReplyBudget: this.config.totalReplyBudget,
		});

		if (decision.targets.length === 0) {
			emitMessageBlocked(envelope.roomId, decision.reason);
			return;
		}

		const [targetAgentId] = decision.targets;
		if (!targetAgentId) {
			emitMessageBlocked(envelope.roomId, "no-target");
			return;
		}

		await this.dispatchMessageToAgent(
			envelope.roomId,
			targetAgentId,
			`[matrix: ${envelope.senderUserId}] ${envelope.body}`,
		);
		emitMessageRouted(targetAgentId, envelope.roomId, decision.reason, Date.now() - startTime);
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		for (const interval of this.typingIntervals.values()) {
			clearInterval(interval);
		}
		this.typingIntervals.clear();
		this.pendingProactiveJobs.clear();
		for (const session of this.sessions.values()) {
			session.dispose();
		}
		this.sessions.clear();
	}

	async dispatchProactiveJob(job: TriggeredJob): Promise<void> {
		if (this.shuttingDown) return;
		const startTime = Date.now();
		emitProactiveJobStarted(job.agentId, job.roomId, job.jobId);
		const message = [
			`[system] Scheduled ${job.kind} job: ${job.jobId}`,
			"You are being triggered proactively by the Bloom daemon.",
			job.prompt,
		].join("\n\n");
		try {
			await this.dispatchMessageToAgent(job.roomId, job.agentId, message);
			emitProactiveJobCompleted(job.agentId, job.roomId, job.jobId, Date.now() - startTime);
		} catch (error) {
			emitProactiveJobFailed(job.agentId, job.roomId, job.jobId, String(error));
			throw error;
		}
		this.enqueueProactiveJob(job.roomId, job.agentId, {
			jobId: job.jobId,
			kind: job.kind,
			quietIfNoop: job.quietIfNoop ?? false,
			...(job.noOpToken ? { noOpToken: job.noOpToken } : {}),
		});
	}

	private async dispatchMessageToAgent(roomId: string, agentId: string, message: string): Promise<void> {
		if (this.shuttingDown) return;
		this.startTyping(roomId, agentId);
		try {
			const agent = this.requireAgent(agentId);
			const alias = await this.matrixBridge.getRoomAlias(agentId, roomId);
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

	private async handleAgentResponse(roomId: string, agentId: string, text: string): Promise<void> {
		if (this.shuttingDown) return;
		const proactiveJob = this.dequeueProactiveJob(roomId, agentId);
		if (proactiveJob) {
			if (proactiveJob.quietIfNoop && proactiveJob.noOpToken && text.trim() === proactiveJob.noOpToken) {
				return;
			}
		}
		await this.matrixBridge.sendText(agentId, roomId, text);
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
			onExit: (exitedAgentId, code) => {
				const sessionKey = this.sessionKey(roomId, exitedAgentId);
				this.sessions.delete(sessionKey);
				this.preambleSent.delete(sessionKey);
				this.stopTyping(roomId, exitedAgentId);
				emitSessionExit(exitedAgentId, roomId, code);
			},
		});

		await session.spawn();
		this.sessions.set(key, session);
		emitSessionSpawned(agent.id, roomId);
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

		void this.matrixBridge.setTyping(agentId, roomId, true, this.config.typingTimeoutMs);
		const interval = setInterval(() => {
			void this.matrixBridge.setTyping(agentId, roomId, true, this.config.typingTimeoutMs);
		}, this.config.typingRefreshMs);
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
		void this.matrixBridge.setTyping(agentId, roomId, false, this.config.typingTimeoutMs);
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
			"Matrix messages must be plain text.",
			"Avoid Markdown, headings, tables, bold, italics, blockquotes, and fenced code blocks.",
			"Use short paragraphs or simple numbered lines when structure helps.",
			"Emoticons are allowed when they add tone, but keep formatting minimal.",
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

	private enqueueProactiveJob(roomId: string, agentId: string, job: PendingProactiveJob): void {
		const key = this.sessionKey(roomId, agentId);
		const queue = this.pendingProactiveJobs.get(key) ?? [];
		queue.push(job);
		this.pendingProactiveJobs.set(key, queue);
	}

	private dequeueProactiveJob(roomId: string, agentId: string): PendingProactiveJob | undefined {
		const key = this.sessionKey(roomId, agentId);
		const queue = this.pendingProactiveJobs.get(key);
		if (!queue || queue.length === 0) return undefined;
		const job = queue.shift();
		if (queue.length === 0) {
			this.pendingProactiveJobs.delete(key);
		} else {
			this.pendingProactiveJobs.set(key, queue);
		}
		return job;
	}
}

function missingMatrixBridge(): never {
	throw new Error("AgentSupervisor requires a Matrix bridge");
}

function buildPiRoomSessionOptions(opts: AgentSessionOptions): PiRoomSessionOptions {
	const sanitizedRoomAlias = sanitizeRoomAlias(opts.roomAlias);
	return {
		roomId: opts.roomId,
		roomAlias: opts.roomAlias,
		sanitizedAlias: `${sanitizedRoomAlias}-${opts.agent.id}`,
		sessionDir: join(opts.sessionBaseDir, sanitizedRoomAlias, opts.agent.id),
		idleTimeoutMs: opts.idleTimeoutMs,
		onAgentEnd: (text) => opts.onAgentEnd(opts.agent.id, text),
		onEvent: (event) => opts.onEvent(opts.agent.id, event),
		onExit: (code) => opts.onExit(opts.agent.id, code),
	};
}

function getDefaultConfig(): DaemonConfig {
	return {
		idleTimeoutMs: 15 * 60 * 1000,
		typingTimeoutMs: 30_000,
		typingRefreshMs: 20_000,
		totalReplyBudget: 4,
		processedEventTtlMs: 5 * 60 * 1000,
		rootReplyTtlMs: 60 * 60 * 1000,
		roomAgentTtlMs: 60 * 60 * 1000,
		maxProcessedEvents: 10_000,
		maxRootReplies: 2_000,
		maxRoomAgentEntries: 2_000,
		seenEventTtlMs: 10 * 60 * 1000,
		maxSeenEventIds: 10_000,
		initialRetryDelayMs: 5_000,
		maxRetryDelayMs: 300_000,
	};
}
