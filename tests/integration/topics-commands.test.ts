import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext, type MockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
});

afterEach(() => {
	temp.cleanup();
});

async function setupTopicsExtension() {
	const mod = await import("../../extensions/bloom-topics.js");
	const api = createMockExtensionAPI();
	const ctx = createMockExtensionContext();
	mod.default(api as never);
	// Fire session_start to set lastCtx
	await api.fireEvent("session_start", {}, ctx);
	return { api, ctx };
}

function getCommandHandler(api: ReturnType<typeof createMockExtensionAPI>) {
	const cmd = api._registeredCommands.find((c) => c.name === "topic");
	if (!cmd) throw new Error("topic command not registered");
	return cmd.handler as (args: string, ctx: MockExtensionContext) => Promise<void>;
}

describe("topics command handler", () => {
	it("/topic new creates active topic and sends followup", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		await handler("new deploy-plan", ctx);

		expect(api._appendedEntries).toContainEqual({
			customType: "bloom-topic",
			data: expect.objectContaining({ name: "deploy-plan", status: "active" }),
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith("Topic started: deploy-plan", "info");
		expect(api._sentMessages).toHaveLength(1);
		expect(api._sentMessages[0].message).toContain("deploy-plan");
	});

	it("/topic new without name shows usage warning", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		await handler("new", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /topic new <name>", "warning");
		expect(api._appendedEntries).toHaveLength(0);
	});

	it("/topic list after creating topics shows topic list", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		// Create a topic first
		await handler("new my-topic", ctx);

		// Mock getEntries to return the appended entry
		ctx.sessionManager.getEntries.mockReturnValue([
			{
				type: "custom",
				customType: "bloom-topic",
				data: { name: "my-topic", status: "active" },
			},
		]);

		await handler("list", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("my-topic"), "info");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("[active]"), "info");
	});

	it("/topic close with active topic closes it", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		// Simulate an active topic in entries
		ctx.sessionManager.getEntries.mockReturnValue([
			{
				type: "custom",
				customType: "bloom-topic",
				data: { name: "deploy-plan", status: "active" },
			},
		]);

		await handler("close", ctx);

		expect(api._appendedEntries).toContainEqual({
			customType: "bloom-topic",
			data: expect.objectContaining({ name: "deploy-plan", status: "closed" }),
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith("Topic closed: deploy-plan", "info");
	});

	it("/topic close with no active topic shows warning", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		await handler("close", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("No active topic to close.", "warning");
	});

	it("/topic switch to existing topic notifies success", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		ctx.sessionManager.getEntries.mockReturnValue([
			{
				type: "custom",
				customType: "bloom-topic",
				data: { name: "design", status: "active", branchPoint: "entry-1" },
			},
		]);

		await handler("switch design", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Switched to topic: design", "info");
		expect(api._appendedEntries).toContainEqual({
			customType: "bloom-topic",
			data: expect.objectContaining({ name: "design", status: "active" }),
		});
	});

	it("/topic switch to nonexistent topic shows warning", async () => {
		const { api, ctx } = await setupTopicsExtension();
		const handler = getCommandHandler(api);

		await handler("switch nonexistent", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Topic not found: nonexistent", "warning");
	});

	it("before_agent_start appends topic guidance to system prompt", async () => {
		const { api } = await setupTopicsExtension();
		const result = await api.fireEvent("before_agent_start", {
			systemPrompt: "Base prompt",
		});

		expect(result).toHaveProperty("systemPrompt");
		const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
		expect(systemPrompt).toContain("Base prompt");
		expect(systemPrompt).toContain("Topic Management");
		expect(systemPrompt).toContain("/topic new");
	});
});
