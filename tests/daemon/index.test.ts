import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSingleAgentRuntimeMock = vi.fn();
const createMultiAgentRuntimeMock = vi.fn();
const startWithRetryMock = vi.fn();
const loadAgentDefinitionsResultMock = vi.fn();
const loadSchedulerStateMock = vi.fn();
const saveSchedulerStateMock = vi.fn();
const readFileSyncMock = vi.fn();
const matrixCredentialsPathMock = vi.fn();
const matrixAgentCredentialsPathMock = vi.fn();
const logInfoMock = vi.fn();
const logWarnMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("node:fs", () => ({
	readFileSync: readFileSyncMock,
}));

vi.mock("../../core/lib/matrix.js", () => ({
	matrixCredentialsPath: matrixCredentialsPathMock,
	matrixAgentCredentialsPath: matrixAgentCredentialsPathMock,
}));

vi.mock("../../core/lib/shared.js", async () => {
	const actual = await vi.importActual<typeof import("../../core/lib/shared.js")>("../../core/lib/shared.js");
	return {
		...actual,
		createLogger: () => ({
			info: logInfoMock,
			warn: logWarnMock,
			error: logErrorMock,
			debug: vi.fn(),
		}),
	};
});

vi.mock("../../core/daemon/agent-registry.js", () => ({
	loadAgentDefinitionsResult: loadAgentDefinitionsResultMock,
}));

vi.mock("../../core/daemon/lifecycle.js", () => ({
	startWithRetry: startWithRetryMock,
}));

vi.mock("../../core/daemon/multi-agent-runtime.js", () => ({
	createMultiAgentRuntime: createMultiAgentRuntimeMock,
}));

vi.mock("../../core/daemon/proactive.js", () => ({
	loadSchedulerState: loadSchedulerStateMock,
	saveSchedulerState: saveSchedulerStateMock,
}));

vi.mock("../../core/daemon/single-agent-runtime.js", () => ({
	createSingleAgentRuntime: createSingleAgentRuntimeMock,
}));

describe("daemon bootstrap", () => {
	const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		loadSchedulerStateMock.mockReturnValue({});
		saveSchedulerStateMock.mockImplementation(() => undefined);
		matrixCredentialsPathMock.mockReturnValue("/tmp/matrix.json");
		matrixAgentCredentialsPathMock.mockImplementation((agentId: string) => `/tmp/${agentId}.json`);
		readFileSyncMock.mockReturnValue(JSON.stringify({ homeserver: "http://matrix", accessToken: "token", userId: "@pi:bloom" }));
		startWithRetryMock.mockImplementation(async (start: () => Promise<void>) => {
			await start();
		});
	});

	afterEach(() => {
		processOnSpy.mockClear();
	});

	it("starts the single-agent runtime when no valid agent definitions exist", async () => {
		const startMock = vi.fn().mockResolvedValue(undefined);
		const stopMock = vi.fn().mockResolvedValue(undefined);
		createSingleAgentRuntimeMock.mockReturnValue({ start: startMock, stop: stopMock });
		loadAgentDefinitionsResultMock.mockReturnValue({ agents: [], errors: ["bad overlay"] });

		await import("../../core/daemon/index.js");

		expect(logWarnMock).toHaveBeenCalledWith("skipping invalid agent definition", { error: "bad overlay" });
		expect(createSingleAgentRuntimeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				storagePath: "/home/alex/.pi/pi-daemon/matrix-state.json",
				sessionBaseDir: "/home/alex/.pi/agent/sessions/bloom-rooms",
				credentials: { homeserver: "http://matrix", accessToken: "token", userId: "@pi:bloom" },
			}),
		);
		expect(startMock).toHaveBeenCalledTimes(1);
		expect(createMultiAgentRuntimeMock).not.toHaveBeenCalled();
	});

	it("starts the multi-agent runtime when valid agent definitions exist", async () => {
		const runtime = {
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			proactiveJobs: 2,
		};
		createMultiAgentRuntimeMock.mockReturnValue(runtime);
		loadAgentDefinitionsResultMock.mockReturnValue({
			agents: [{ id: "ops" }, { id: "support" }],
			errors: [],
		});

		const bootstrapModule = "../../core/daemon/index.js?multi";
		await import(bootstrapModule);

		expect(createMultiAgentRuntimeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agents: [{ id: "ops" }, { id: "support" }],
				sessionBaseDir: "/home/alex/.pi/agent/sessions/bloom-rooms",
				matrixAgentStorageDir: "/home/alex/.pi/pi-daemon/matrix-agents",
			}),
		);
		expect(startWithRetryMock).toHaveBeenCalledTimes(1);
		expect(runtime.start).toHaveBeenCalledTimes(1);
		expect(createSingleAgentRuntimeMock).not.toHaveBeenCalled();
	});
});
