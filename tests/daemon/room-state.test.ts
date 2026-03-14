import { describe, expect, it } from "vitest";

import {
	canReplyForRoot,
	createRoomState,
	hasProcessedEvent,
	isAgentCoolingDown,
	markEventProcessed,
	markReplySent,
} from "../../core/daemon/room-state.js";

describe("room-state", () => {
	it("tracks processed event ids", () => {
		const state = createRoomState();
		expect(hasProcessedEvent(state, "$evt1", 1_000)).toBe(false);
		markEventProcessed(state, "$evt1", 1_000);
		expect(hasProcessedEvent(state, "$evt1", 1_000)).toBe(true);
	});

	it("expires processed event ids after retention window", () => {
		const state = createRoomState({ processedEventTtlMs: 1000 });
		markEventProcessed(state, "$evt1", 1_000);
		expect(hasProcessedEvent(state, "$evt1", 1_500)).toBe(true);
		expect(hasProcessedEvent(state, "$evt1", 2_100)).toBe(false);
	});

	it("tracks per-agent cooldowns", () => {
		const state = createRoomState();
		markReplySent(state, "!room:bloom", "$root1", "planner", 10_000);
		expect(isAgentCoolingDown(state, "!room:bloom", "planner", 11_000, 1500)).toBe(true);
		expect(isAgentCoolingDown(state, "!room:bloom", "planner", 12_000, 1500)).toBe(false);
	});

	it("tracks total and per-agent budgets per root event", () => {
		const state = createRoomState();
		expect(canReplyForRoot(state, "!room:bloom", "$root1", "planner", 2, 4)).toBe(true);
		markReplySent(state, "!room:bloom", "$root1", "planner", 1_000);
		expect(canReplyForRoot(state, "!room:bloom", "$root1", "planner", 2, 4)).toBe(true);
		markReplySent(state, "!room:bloom", "$root1", "planner", 2_000);
		expect(canReplyForRoot(state, "!room:bloom", "$root1", "planner", 2, 4)).toBe(false);
	});

	it("enforces total reply budget across agents for the same root", () => {
		const state = createRoomState();
		markReplySent(state, "!room:bloom", "$root1", "host", 1_000);
		markReplySent(state, "!room:bloom", "$root1", "planner", 2_000);
		markReplySent(state, "!room:bloom", "$root1", "critic", 3_000);
		markReplySent(state, "!room:bloom", "$root1", "host", 4_000);
		expect(canReplyForRoot(state, "!room:bloom", "$root1", "planner", 2, 4)).toBe(false);
	});

	it("prunes stale root reply and cooldown state", () => {
		const state = createRoomState({ rootReplyTtlMs: 1000, roomAgentTtlMs: 1000 });
		markReplySent(state, "!room:bloom", "$root1", "planner", 1_000);

		expect(canReplyForRoot(state, "!room:bloom", "$root1", "planner", 2, 4)).toBe(true);
		expect(isAgentCoolingDown(state, "!room:bloom", "planner", 2_500, 1500)).toBe(false);
		expect(canReplyForRoot(state, "!room:bloom", "$root1", "planner", 2, 4)).toBe(true);
	});
});
