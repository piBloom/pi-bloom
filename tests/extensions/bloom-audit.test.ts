import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatEntries, handleAuditReview, readEntries } from "../../core/pi-extensions/bloom-audit/actions.js";
import type { AuditEntry } from "../../core/pi-extensions/bloom-audit/types.js";
import { type MockExtensionAPI, createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { type TempGarden, createTempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
});

afterEach(() => {
	temp.cleanup();
});

// ---------------------------------------------------------------------------
// formatEntries
// ---------------------------------------------------------------------------
describe("formatEntries", () => {
	const baseEntry: AuditEntry = {
		ts: "2026-01-01T00:00:00.000Z",
		event: "tool_call",
		tool: "memory_create",
		toolCallId: "call-1",
		input: { slug: "my-note" },
	};

	const resultEntry: AuditEntry = {
		ts: "2026-01-01T00:00:01.000Z",
		event: "tool_result",
		tool: "memory_create",
		toolCallId: "call-1",
		isError: false,
	};

	const errorEntry: AuditEntry = {
		ts: "2026-01-01T00:00:02.000Z",
		event: "tool_result",
		tool: "memory_create",
		toolCallId: "call-2",
		isError: true,
	};

	it("formats a tool_call entry with status 'call'", () => {
		const output = formatEntries([baseEntry], false);
		expect(output).toContain("memory_create");
		expect(output).toContain("[call]");
		expect(output).toContain("2026-01-01");
	});

	it("formats a successful tool_result entry with status 'ok'", () => {
		const output = formatEntries([resultEntry], false);
		expect(output).toContain("[ok]");
	});

	it("formats an error tool_result entry with status 'error'", () => {
		const output = formatEntries([errorEntry], false);
		expect(output).toContain("[error]");
	});

	it("does not include input when includeInputs is false", () => {
		const output = formatEntries([baseEntry], false);
		expect(output).not.toContain("input:");
		expect(output).not.toContain("my-note");
	});

	it("includes input line when includeInputs is true", () => {
		const output = formatEntries([baseEntry], true);
		expect(output).toContain("input:");
	});

	it("does not add input line for tool_result even when includeInputs is true", () => {
		const output = formatEntries([resultEntry], true);
		expect(output).not.toContain("input:");
	});

	it("handles an empty entries array", () => {
		const output = formatEntries([], false);
		expect(output).toBe("");
	});

	it("formats multiple entries, one per line", () => {
		const output = formatEntries([baseEntry, resultEntry], false);
		const lines = output.split("\n").filter((l) => l.startsWith("-"));
		expect(lines).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// bash audit entries
// ---------------------------------------------------------------------------
describe("bash audit entries", () => {
	const bashInvokeEntry: AuditEntry = {
		ts: "2026-01-01T00:00:03.000Z",
		event: "bash_invoke",
		tool: "bash",
		toolCallId: "bash-1",
		input: { cmd: "ls -la" },
	};

	const bashResultEntry: AuditEntry = {
		ts: "2026-01-01T00:00:04.000Z",
		event: "bash_result",
		tool: "bash",
		toolCallId: "bash-1",
		exitCode: 0,
	};

	it("formats a bash_invoke entry with status 'call'", () => {
		const output = formatEntries([bashInvokeEntry], false);
		expect(output).toContain("bash");
		expect(output).toContain("[call]");
	});

	it("formats a bash_result entry with status 'ok' when exitCode is 0", () => {
		const output = formatEntries([bashResultEntry], false);
		expect(output).toContain("[ok]");
	});
});

// ---------------------------------------------------------------------------
// bash operations wrapper (user_bash hook)
// ---------------------------------------------------------------------------
describe("bash operations wrapper", () => {
	let bashApi: MockExtensionAPI;
	let mockBashRun: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		temp = createTempGarden();
		bashApi = createMockExtensionAPI();

		// Provide a fake local bash runner so tests don't need a real shell
		mockBashRun = vi.fn().mockResolvedValue({ exitCode: 0 });
		vi.doMock("@mariozechner/pi-coding-agent", async (importOriginal) => {
			const actual = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
			return {
				...actual,
				createLocalBashOperations: () => ({ exec: mockBashRun }),
			};
		});

		vi.resetModules();
		const mod = await import("../../core/pi-extensions/bloom-audit/index.js");
		mod.default(bashApi as never);
	});

	afterEach(() => {
		temp.cleanup();
		vi.doUnmock("@mariozechner/pi-coding-agent");
		vi.resetModules();
	});

	it("registers a user_bash event handler on init", () => {
		expect(bashApi._eventHandlers.has("user_bash")).toBe(true);
	});

	it("user_bash handler returns operations object with a run function", async () => {
		const result = (await bashApi.fireUserBash("ls -la")) as { operations?: { exec: unknown } };
		expect(result?.operations).toBeDefined();
		expect(typeof result?.operations?.exec).toBe("function");
	});

	it("logs bash_invoke entry before running the command", async () => {
		const handlerResult = (await bashApi.fireUserBash("echo hello")) as { operations?: { exec: (...a: unknown[]) => Promise<unknown> } };
		await handlerResult!.operations!.exec("echo hello", "/tmp", { onData: () => {} });

		const entries = readEntries(1);
		const invokeEntry = entries.find((e) => e.event === "bash_invoke");
		expect(invokeEntry).toBeDefined();
		expect(invokeEntry?.tool).toBe("bash");
		expect((invokeEntry?.input as { cmd?: string })?.cmd).toBe("echo hello");
	});

	it("logs bash_result entry after the command completes", async () => {
		const handlerResult = (await bashApi.fireUserBash("echo hello")) as { operations?: { exec: (...a: unknown[]) => Promise<unknown> } };
		await handlerResult!.operations!.exec("echo hello", "/tmp", { onData: () => {} });

		const entries = readEntries(1);
		const resultEntry = entries.find((e) => e.event === "bash_result");
		expect(resultEntry).toBeDefined();
		expect(resultEntry?.tool).toBe("bash");
		expect(resultEntry?.exitCode).toBe(0);
	});

	it("bash_invoke and bash_result share the same toolCallId", async () => {
		const handlerResult = (await bashApi.fireUserBash("echo hello")) as { operations?: { exec: (...a: unknown[]) => Promise<unknown> } };
		await handlerResult!.operations!.exec("echo hello", "/tmp", { onData: () => {} });

		const entries = readEntries(1);
		const invokeEntry = entries.find((e) => e.event === "bash_invoke");
		const resultEntry = entries.find((e) => e.event === "bash_result");
		expect(invokeEntry?.toolCallId).toBe(resultEntry?.toolCallId);
	});
});

// ---------------------------------------------------------------------------
// handleAuditReview
// ---------------------------------------------------------------------------
describe("handleAuditReview", () => {
	it("returns empty-result message when no audit directory exists", () => {
		// temp garden dir has no audit subdir created
		const result = handleAuditReview({ days: 1 });
		expect(result.content[0].text).toContain("No audit entries found");
		expect(result.details).toMatchObject({ count: 0 });
	});

	it("returns empty-result message when audit dir exists but has no files", () => {
		import("node:fs").then(({ mkdirSync }) => {
			import("node:path").then(({ join }) => {
				mkdirSync(join(temp.gardenDir, "audit"), { recursive: true });
			});
		});
		const result = handleAuditReview({ days: 1 });
		expect(result.content[0].text).toContain("No audit entries found");
	});

	it("respects the days parameter in details", () => {
		const result = handleAuditReview({ days: 7 });
		expect(result.details).toMatchObject({ days: 7 });
	});

	it("clamps days to a minimum of 1", () => {
		const result = handleAuditReview({ days: 0 });
		expect(result.details).toMatchObject({ days: 1 });
	});

	it("clamps days to a maximum of 30", () => {
		const result = handleAuditReview({ days: 999 });
		expect(result.details).toMatchObject({ days: 30 });
	});
});
