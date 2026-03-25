import { join } from "node:path";
import { createLogger } from "../lib/shared.js";
import type { AgentDefinition } from "./agent-registry.js";
import type { DaemonConfig } from "./config.js";
import type { AgentSessionLike, SessionEvent } from "./contracts/session.js";
import {
	emitMessageBlocked,
	emitMessageRouted,
	emitProactiveJobCompleted,
	emitProactiveJobFailed,
	emitProactiveJobStarted,
	emitSessionExit,
	emitSessionSpawned,
} from "./metrics.js";
import { withRetry } from "../lib/retry.js";
import { enforceMapLimit, pruneExpiredEntries } from "./ordered-cache.js";
import { PiRoomSession, type PiRoomSessionOptions } from "./runtime/pi-room-session.js";
import type { TriggeredJob } from "./scheduler.js";

export interface RoomEnvelope {
	roomId: string;
	eventId: string;
	senderUserId: string;
	body: string;
	senderKind: "human" | "agent" | "self" | "unknown";
	senderAgentId?: string;
	mentions: string[];
	timestamp: number;
}

export interface RouteDecision {
	targets: [string] | [];
	reason:
		| "host-default"
		| "explicit-mention"
		| "agent-mention"
		| "ignored-self"
		| "ignored-duplicate"
		| "ignored-policy"
		| "ignored-budget"
		| "ignored-cooldown";
}

export interface RouteOptions {
	rootEventId?: string;
	totalReplyBudget?: number;
}

const DEFAULT_ALLOW_AGENT_MENTIONS = true;
const DEFAULT_MAX_PUBLIC_TURNS_PER_ROOT = 2;
const DEFAULT_COOLDOWN_MS = 1500;

interface InitialTargetDecision {
	targets: [AgentDefinition] | [];
	reason: RouteDecision["reason"];
}

const log = createLogger("agent-supervisor");

/** Sanitize a Matrix room alias or ID into a filesystem-safe name. */
export function sanitizeRoomAlias(alias: string): string {
	return alias.replace(/^[#!]/, "").replaceAll(":", "_");
}

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
	createSession?: (opts: AgentSessionOptions) => AgentSessionLike;
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
	private readonly activeProactiveJobs = new Set<string>();
	private readonly createSession: (opts: AgentSessionOptions) => AgentSessionLike;
	private readonly processedEvents = new Map<string, number>();
	private readonly rootReplies = new Map<
		string,
		{ perAgentReplies: Map<string, number>; totalReplies: number; lastTouchedAt: number }
	>();
	private readonly lastReplyAtByRoomAgent = new Map<string, number>();
	private readonly pendingProactiveJobs = new Map<string, PendingProactiveJob[]>();
	private readonly sessions = new Map<string, AgentSessionLike>();
	private readonly preambleSent = new Set<string>();
	private readonly typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
	private shuttingDown = false;

	constructor(options: AgentSupervisorOptions) {
		this.agents = options.agents;
		this.matrixBridge = options.matrixBridge ?? missingMatrixBridge();
		this.sessionBaseDir = options.sessionBaseDir;
		this.idleTimeoutMs = options.idleTimeoutMs;
		this.config = options.config ?? getDefaultConfig();
		this.createSession = options.createSession ?? ((opts) => new PiRoomSession(buildPiRoomSessionOptions(opts)));
	}

	async handleEnvelope(envelope: RoomEnvelope): Promise<void> {
		if (this.shuttingDown) return;
		const startTime = Date.now();
		const decision = this.routeRoomEnvelope(envelope, {
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

	private routeRoomEnvelope(envelope: RoomEnvelope, options: RouteOptions = {}): RouteDecision {
		const ignoredReason = this.getIgnoredReason(envelope);
		if (ignoredReason) return { targets: [], reason: ignoredReason };

		const rootEventId = options.rootEventId ?? envelope.eventId;
		const totalReplyBudget = options.totalReplyBudget ?? 4;
		const initialDecision = getInitialTargetDecision(envelope, this.agents);
		if (initialDecision.targets.length === 0) return { targets: [], reason: "ignored-policy" };

		const [targetAgent] = initialDecision.targets;
		if (!targetAgent) {
			return { targets: [], reason: "ignored-policy" };
		}

		const canReply = this.canReplyForRoot(
			envelope.roomId,
			rootEventId,
			targetAgent.id,
			DEFAULT_MAX_PUBLIC_TURNS_PER_ROOT,
			totalReplyBudget,
			envelope.timestamp,
		);
		if (!canReply) {
			return { targets: [], reason: "ignored-budget" };
		}

		if (this.isAgentCoolingDown(envelope.roomId, targetAgent.id, envelope.timestamp, DEFAULT_COOLDOWN_MS)) {
			return { targets: [], reason: "ignored-cooldown" };
		}

		this.markReplySent(envelope.roomId, rootEventId, targetAgent.id, envelope.timestamp);

		return {
			targets: [targetAgent.id],
			reason: initialDecision.reason,
		};
	}

	private getIgnoredReason(
		envelope: RoomEnvelope,
	): Extract<RouteDecision["reason"], "ignored-self" | "ignored-duplicate"> | undefined {
		if (envelope.senderKind === "self") return "ignored-self";
		if (this.hasProcessedEvent(envelope.eventId, envelope.timestamp)) return "ignored-duplicate";
		this.markEventProcessed(envelope.eventId, envelope.timestamp);
		return undefined;
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

		// Skip if a proactive job for this agent is already in flight
		if (this.activeProactiveJobs.has(job.agentId)) {
			const reason = `proactive job already in flight for agent ${job.agentId}`;
			log.warn("proactive job skipped", { jobId: job.jobId, agentId: job.agentId, reason });
			emitProactiveJobFailed(job.agentId, job.roomId, job.jobId, reason);
			return;
		}

		this.activeProactiveJobs.add(job.agentId);
		const startTime = Date.now();
		emitProactiveJobStarted(job.agentId, job.roomId, job.jobId);
		const message = [
			`[system] Scheduled ${job.kind} job: ${job.jobId}`,
			"You are being triggered proactively by the main daemon.",
			job.prompt,
		].join("\n\n");
		try {
			await withRetry(() => this.dispatchMessageToAgent(job.roomId, job.agentId, message), {
				maxRetries: 3,
				baseDelayMs: 1000,
			});
			emitProactiveJobCompleted(job.agentId, job.roomId, job.jobId, Date.now() - startTime);
		} catch (error) {
			emitProactiveJobFailed(job.agentId, job.roomId, job.jobId, String(error));
			throw error;
		} finally {
			this.activeProactiveJobs.delete(job.agentId);
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
	): Promise<AgentSessionLike> {
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
			`[system] You are the agent "${agent.name}".`,
			`Your Matrix identity is ${agent.matrix.userId}.`,
			`You are participating in room ${roomAlias}.`,
			"Other agents may also be present.",
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

	// ── Room-state methods ────────────────────────────────────────────────────

	private hasProcessedEvent(eventId: string, now: number): boolean {
		this.pruneRoomState(now);
		return this.processedEvents.has(eventId);
	}

	private markEventProcessed(eventId: string, now: number): void {
		this.pruneRoomState(now);
		this.processedEvents.set(eventId, now);
		enforceMapLimit(this.processedEvents, this.config.maxProcessedEvents);
	}

	private isAgentCoolingDown(roomId: string, agentId: string, now: number, cooldownMs: number): boolean {
		this.pruneRoomState(now);
		const lastReplyAt = this.lastReplyAtByRoomAgent.get(roomAgentKey(roomId, agentId));
		if (lastReplyAt === undefined) return false;
		return now - lastReplyAt < cooldownMs;
	}

	private canReplyForRoot(
		roomId: string,
		rootEventId: string,
		agentId: string,
		maxPublicTurnsPerRoot: number,
		totalReplyBudget: number,
		now?: number,
	): boolean {
		if (typeof now === "number") {
			this.pruneRoomState(now);
		}
		const rootState = this.rootReplies.get(rootKey(roomId, rootEventId));
		if (!rootState) return true;
		if (rootState.totalReplies >= totalReplyBudget) return false;
		return (rootState.perAgentReplies.get(agentId) ?? 0) < maxPublicTurnsPerRoot;
	}

	private markReplySent(roomId: string, rootEventId: string, agentId: string, now: number): void {
		this.pruneRoomState(now);
		this.lastReplyAtByRoomAgent.set(roomAgentKey(roomId, agentId), now);
		enforceMapLimit(this.lastReplyAtByRoomAgent, this.config.maxRoomAgentEntries);

		const key = rootKey(roomId, rootEventId);
		let rootState = this.rootReplies.get(key);
		if (!rootState) {
			rootState = { totalReplies: 0, perAgentReplies: new Map(), lastTouchedAt: now };
			this.rootReplies.set(key, rootState);
		}

		rootState.totalReplies++;
		rootState.lastTouchedAt = now;
		rootState.perAgentReplies.set(agentId, (rootState.perAgentReplies.get(agentId) ?? 0) + 1);
		enforceMapLimit(this.rootReplies, this.config.maxRootReplies);
	}

	private pruneRoomState(now: number): void {
		pruneExpiredEntries(
			this.processedEvents,
			now,
			(timestamp) => timestamp,
			this.config.processedEventTtlMs,
		);
		pruneExpiredEntries(
			this.lastReplyAtByRoomAgent,
			now,
			(timestamp) => timestamp,
			this.config.roomAgentTtlMs,
		);
		pruneExpiredEntries(
			this.rootReplies,
			now,
			(rootState) => rootState.lastTouchedAt,
			this.config.rootReplyTtlMs,
		);
	}
}

export function extractMentions(body: string, agents: readonly AgentDefinition[]): string[] {
	return agents
		.map((agent) => ({ userId: agent.matrix.userId, index: body.indexOf(agent.matrix.userId) }))
		.filter((hit) => hit.index >= 0)
		.sort((left, right) => left.index - right.index)
		.map((hit) => hit.userId);
}

export function classifySender(
	senderUserId: string,
	selfUserId: string,
	agents: readonly AgentDefinition[],
): { senderKind: RoomEnvelope["senderKind"]; senderAgentId?: string } {
	if (senderUserId === selfUserId) return { senderKind: "self" };
	const agent = agents.find((candidate) => candidate.matrix.userId === senderUserId);
	if (agent) return { senderKind: "agent", senderAgentId: agent.id };
	if (/^@[a-zA-Z0-9._=\-/]+:[a-zA-Z0-9.-]+$/.test(senderUserId)) return { senderKind: "human" };
	return { senderKind: "unknown" };
}

function getInitialTargetDecision(envelope: RoomEnvelope, agents: readonly AgentDefinition[]): InitialTargetDecision {
	const mentionedAgents = getMentionedAgents(envelope.mentions, agents);
	if (envelope.senderKind === "human") {
		return getHumanTargetDecision(envelope.mentions.length > 0, mentionedAgents, agents);
	}
	if (envelope.senderKind === "agent") {
		return getAgentTargetDecision(envelope.senderAgentId, mentionedAgents);
	}
	return { targets: [], reason: "ignored-policy" };
}

function getMentionedAgents(mentions: readonly string[], agents: readonly AgentDefinition[]): AgentDefinition[] {
	return mentions.flatMap((userId) => {
		const agent = agents.find((candidate) => candidate.matrix.userId === userId);
		if (!agent || agent.respond.mode === "silent") return [];
		return [agent];
	});
}

function getHumanTargetDecision(
	hadExplicitMention: boolean,
	mentionedAgents: readonly AgentDefinition[],
	agents: readonly AgentDefinition[],
): InitialTargetDecision {
	if (hadExplicitMention && mentionedAgents.length > 0) {
		const [firstMentionedAgent] = mentionedAgents;
		return firstMentionedAgent
			? { targets: [firstMentionedAgent], reason: "explicit-mention" }
			: { targets: [], reason: "ignored-policy" };
	}

	const hostAgent = agents.find((agent) => agent.respond.mode === "host");
	if (hadExplicitMention || !hostAgent) return { targets: [], reason: "ignored-policy" };
	return { targets: [hostAgent], reason: "host-default" };
}

function getAgentTargetDecision(
	senderAgentId: string | undefined,
	mentionedAgents: readonly AgentDefinition[],
): InitialTargetDecision {
	const target = mentionedAgents.find((agent) => agent.id !== senderAgentId && DEFAULT_ALLOW_AGENT_MENTIONS);
	if (!target) return { targets: [], reason: "ignored-policy" };
	return { targets: [target], reason: "agent-mention" };
}

function roomAgentKey(roomId: string, agentId: string): string {
	return `${roomId}::${agentId}`;
}

function rootKey(roomId: string, rootEventId: string): string {
	return `${roomId}::${rootEventId}`;
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
