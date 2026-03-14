export interface RoomStateOptions {
	processedEventTtlMs?: number;
	rootReplyTtlMs?: number;
	roomAgentTtlMs?: number;
	maxProcessedEvents?: number;
	maxRootReplies?: number;
	maxRoomAgentEntries?: number;
}

interface RootReplyState {
	totalReplies: number;
	perAgentReplies: Map<string, number>;
	lastTouchedAt: number;
}

export interface RoomState {
	processedEventTtlMs: number;
	rootReplyTtlMs: number;
	roomAgentTtlMs: number;
	maxProcessedEvents: number;
	maxRootReplies: number;
	maxRoomAgentEntries: number;
	processedEvents: Map<string, number>;
	lastReplyAtByRoomAgent: Map<string, number>;
	rootReplies: Map<string, RootReplyState>;
}

const DEFAULT_PROCESSED_EVENT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ROOT_REPLY_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ROOM_AGENT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PROCESSED_EVENTS = 10_000;
const DEFAULT_MAX_ROOT_REPLIES = 2_000;
const DEFAULT_MAX_ROOM_AGENT_ENTRIES = 2_000;

export function createRoomState(options: RoomStateOptions = {}): RoomState {
	return {
		processedEventTtlMs: options.processedEventTtlMs ?? DEFAULT_PROCESSED_EVENT_TTL_MS,
		rootReplyTtlMs: options.rootReplyTtlMs ?? DEFAULT_ROOT_REPLY_TTL_MS,
		roomAgentTtlMs: options.roomAgentTtlMs ?? DEFAULT_ROOM_AGENT_TTL_MS,
		maxProcessedEvents: options.maxProcessedEvents ?? DEFAULT_MAX_PROCESSED_EVENTS,
		maxRootReplies: options.maxRootReplies ?? DEFAULT_MAX_ROOT_REPLIES,
		maxRoomAgentEntries: options.maxRoomAgentEntries ?? DEFAULT_MAX_ROOM_AGENT_ENTRIES,
		processedEvents: new Map(),
		lastReplyAtByRoomAgent: new Map(),
		rootReplies: new Map(),
	};
}

export function hasProcessedEvent(state: RoomState, eventId: string, now: number): boolean {
	pruneState(state, now);
	return state.processedEvents.has(eventId);
}

export function markEventProcessed(state: RoomState, eventId: string, now: number): void {
	pruneState(state, now);
	state.processedEvents.set(eventId, now);
	enforceMapLimit(state.processedEvents, state.maxProcessedEvents);
}

export function isAgentCoolingDown(
	state: RoomState,
	roomId: string,
	agentId: string,
	now: number,
	cooldownMs: number,
): boolean {
	pruneState(state, now);
	const lastReplyAt = state.lastReplyAtByRoomAgent.get(roomAgentKey(roomId, agentId));
	if (lastReplyAt === undefined) return false;
	return now - lastReplyAt < cooldownMs;
}

export function canReplyForRoot(
	state: RoomState,
	roomId: string,
	rootEventId: string,
	agentId: string,
	maxPublicTurnsPerRoot: number,
	totalReplyBudget: number,
	now?: number,
): boolean {
	if (typeof now === "number") {
		pruneState(state, now);
	}
	const rootState = state.rootReplies.get(rootKey(roomId, rootEventId));
	if (!rootState) return true;
	if (rootState.totalReplies >= totalReplyBudget) return false;
	return (rootState.perAgentReplies.get(agentId) ?? 0) < maxPublicTurnsPerRoot;
}

export function markReplySent(
	state: RoomState,
	roomId: string,
	rootEventId: string,
	agentId: string,
	now: number,
): void {
	pruneState(state, now);
	state.lastReplyAtByRoomAgent.set(roomAgentKey(roomId, agentId), now);
	enforceMapLimit(state.lastReplyAtByRoomAgent, state.maxRoomAgentEntries);

	const key = rootKey(roomId, rootEventId);
	let rootState = state.rootReplies.get(key);
	if (!rootState) {
		rootState = { totalReplies: 0, perAgentReplies: new Map(), lastTouchedAt: now };
		state.rootReplies.set(key, rootState);
	}

	rootState.totalReplies++;
	rootState.lastTouchedAt = now;
	rootState.perAgentReplies.set(agentId, (rootState.perAgentReplies.get(agentId) ?? 0) + 1);
	enforceMapLimit(state.rootReplies, state.maxRootReplies);
}

function pruneState(state: RoomState, now: number): void {
	for (const [eventId, timestamp] of state.processedEvents) {
		if (now - timestamp > state.processedEventTtlMs) {
			state.processedEvents.delete(eventId);
		}
	}
	for (const [key, timestamp] of state.lastReplyAtByRoomAgent) {
		if (now - timestamp > state.roomAgentTtlMs) {
			state.lastReplyAtByRoomAgent.delete(key);
		}
	}
	for (const [key, rootState] of state.rootReplies) {
		if (now - rootState.lastTouchedAt > state.rootReplyTtlMs) {
			state.rootReplies.delete(key);
		}
	}
}

function enforceMapLimit<K, V>(map: Map<K, V>, maxEntries: number): void {
	while (map.size > maxEntries) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

function roomAgentKey(roomId: string, agentId: string): string {
	return `${roomId}::${agentId}`;
}

function rootKey(roomId: string, rootEventId: string): string {
	return `${roomId}::${rootEventId}`;
}
