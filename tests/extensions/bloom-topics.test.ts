import { describe, expect, it } from "vitest";
import { handleTopicCommand } from "../../extensions/bloom-topics/actions.js";

// ---------------------------------------------------------------------------
// handleTopicCommand
// ---------------------------------------------------------------------------
describe("handleTopicCommand", () => {
	it("returns notify for empty subcommand", () => {
		const result = handleTopicCommand("", null);
		expect(result).toEqual({
			action: "notify",
			message: "Usage: /topic new <name> | close | list | switch <name>",
			level: "info",
		});
	});

	it("returns notify for unknown subcommand", () => {
		const result = handleTopicCommand("foo", null);
		expect(result).toEqual({
			action: "notify",
			message: "Usage: /topic new <name> | close | list | switch <name>",
			level: "info",
		});
	});

	// --- new ---
	it("returns notify warning when 'new' has no name", () => {
		const result = handleTopicCommand("new", null);
		expect(result).toEqual({ action: "notify", message: "Usage: /topic new <name>", level: "warning" });
	});

	it("returns start action for 'new <name>'", () => {
		const result = handleTopicCommand("new deploy-planning", null);
		expect(result).toEqual({ action: "start", name: "deploy-planning", message: expect.stringContaining("deploy-planning") });
	});

	it("handles multi-word topic names for 'new'", () => {
		const result = handleTopicCommand("new my cool topic", null);
		expect(result).toEqual({
			action: "start",
			name: "my cool topic",
			message: expect.stringContaining("my cool topic"),
		});
	});

	// --- close ---
	it("returns notify warning when closing with no active topic", () => {
		const result = handleTopicCommand("close", null);
		expect(result).toEqual({ action: "notify", message: "No active topic to close.", level: "warning" });
	});

	it("returns close action when there is an active topic", () => {
		const ctx = makeMockCtx([{ name: "deploy", status: "active", branchPoint: "bp1" }]);
		const result = handleTopicCommand("close", ctx);
		expect(result).toEqual({
			action: "close",
			name: "deploy",
			branchPoint: "bp1",
			message: expect.stringContaining("deploy"),
		});
	});

	// --- list ---
	it("returns notify when list has no topics", () => {
		const result = handleTopicCommand("list", null);
		expect(result).toEqual({ action: "notify", message: "No topics found in this session.", level: "info" });
	});

	it("returns list action with topics", () => {
		const ctx = makeMockCtx([
			{ name: "topic-a", status: "active", branchPoint: undefined },
			{ name: "topic-b", status: "closed", branchPoint: "bp2" },
		]);
		const result = handleTopicCommand("list", ctx);
		expect(result.action).toBe("list");
		if (result.action === "list") {
			expect(result.topics).toHaveLength(2);
			expect(result.topics[0].name).toBe("topic-a");
		}
	});

	// --- switch ---
	it("returns notify warning when 'switch' has no name", () => {
		const result = handleTopicCommand("switch", null);
		expect(result).toEqual({ action: "notify", message: "Usage: /topic switch <name>", level: "warning" });
	});

	it("returns notify warning when switch target not found", () => {
		const ctx = makeMockCtx([{ name: "other", status: "active", branchPoint: undefined }]);
		const result = handleTopicCommand("switch nonexistent", ctx);
		expect(result).toEqual({
			action: "notify",
			message: "Topic not found: nonexistent",
			level: "warning",
		});
	});

	it("returns switch action when target exists", () => {
		const ctx = makeMockCtx([{ name: "deploy", status: "closed", branchPoint: "bp1" }]);
		const result = handleTopicCommand("switch deploy", ctx);
		expect(result).toEqual({ action: "switch", name: "deploy", branchPoint: "bp1" });
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TopicEntry {
	name: string;
	status: "active" | "closed";
	branchPoint: string | undefined;
}

function makeMockCtx(topics: TopicEntry[]) {
	const entries = topics.map((t) => ({
		type: "custom" as const,
		customType: "bloom-topic",
		data: { name: t.name, status: t.status, branchPoint: t.branchPoint },
	}));
	return {
		sessionManager: {
			getEntries: () => entries,
			getLeafEntry: () => (entries.length > 0 ? { id: "leaf-id" } : undefined),
		},
	} as never;
}
