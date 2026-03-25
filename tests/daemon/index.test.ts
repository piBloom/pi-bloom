import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const bridgeStartMock = vi.fn().mockResolvedValue(undefined);
	const bridgeStopMock = vi.fn();
	const bridgeOnTextEventMock = vi.fn();

	const supervisorHandleEnvelopeMock = vi.fn();
	const supervisorDispatchProactiveMock = vi.fn();
	const supervisorShutdownMock = vi.fn().mockResolvedValue(undefined);

	const schedulerStartMock = vi.fn();
	const schedulerStopMock = vi.fn();

	const MockBridge = vi.fn();
	const MockSupervisor = vi.fn();
	const MockScheduler = vi.fn();

	const withRetryMock = vi.fn();
	const loadRuntimeAgentsMock = vi.fn();
	const loadSchedulerStateMock = vi.fn().mockReturnValue({});
	const saveSchedulerStateMock = vi.fn();
	const collectScheduledJobsMock = vi.fn().mockReturnValue([]);
	const readFileSyncMock = vi.fn();
	const matrixCredentialsPathMock = vi.fn().mockReturnValue("/tmp/matrix.json");
	const matrixAgentCredentialsPathMock = vi.fn().mockImplementation((id: string) => `/tmp/${id}.json`);
	const logInfoMock = vi.fn();
	const logWarnMock = vi.fn();
	const logErrorMock = vi.fn();

	return {
		bridgeStartMock,
		bridgeStopMock,
		bridgeOnTextEventMock,
		supervisorHandleEnvelopeMock,
		supervisorDispatchProactiveMock,
		supervisorShutdownMock,
		schedulerStartMock,
		schedulerStopMock,
		MockBridge,
		MockSupervisor,
		MockScheduler,
		withRetryMock,
		loadRuntimeAgentsMock,
		loadSchedulerStateMock,
		saveSchedulerStateMock,
		collectScheduledJobsMock,
		readFileSyncMock,
		matrixCredentialsPathMock,
		matrixAgentCredentialsPathMock,
		logInfoMock,
		logWarnMock,
		logErrorMock,
	};
});

vi.mock("node:fs", () => ({
	readFileSync: mocks.readFileSyncMock,
}));

vi.mock("../../core/lib/matrix.js", () => ({
	matrixCredentialsPath: mocks.matrixCredentialsPathMock,
	matrixAgentCredentialsPath: mocks.matrixAgentCredentialsPathMock,
}));

vi.mock("../../core/lib/shared.js", async () => {
	const actual = await vi.importActual<typeof import("../../core/lib/shared.js")>("../../core/lib/shared.js");
	return {
		...actual,
		createLogger: () => ({
			info: mocks.logInfoMock,
			warn: mocks.logWarnMock,
			error: mocks.logErrorMock,
			debug: vi.fn(),
		}),
	};
});

vi.mock("../../core/daemon/agent-registry.js", () => ({
	loadRuntimeAgents: mocks.loadRuntimeAgentsMock,
}));

vi.mock("../../core/lib/retry.js", () => ({
	withRetry: mocks.withRetryMock,
}));

vi.mock("../../core/daemon/agent-supervisor.js", () => ({
	AgentSupervisor: mocks.MockSupervisor,
	classifySender: vi.fn().mockReturnValue({ senderKind: "human" }),
	extractMentions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../core/daemon/runtime/matrix-js-sdk-bridge.js", () => ({
	MatrixJsSdkBridge: mocks.MockBridge,
}));

vi.mock("../../core/daemon/scheduler.js", () => ({
	Scheduler: mocks.MockScheduler,
}));

vi.mock("../../core/daemon/proactive.js", () => ({
	loadSchedulerState: mocks.loadSchedulerStateMock,
	saveSchedulerState: mocks.saveSchedulerStateMock,
	collectScheduledJobs: mocks.collectScheduledJobsMock,
}));

describe("daemon bootstrap", () => {
	const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
	const homeDir = os.homedir();

	const defaultCredentials = JSON.stringify({
		homeserver: "http://matrix",
		botAccessToken: "token",
		botPassword: "secret",
		botUserId: "@pi:nixpi",
		registrationToken: "reg-token",
	});

	beforeEach(() => {
		vi.resetModules();
		// Use regular function (not arrow) so new MockX() works correctly
		mocks.MockBridge.mockImplementation(function (this: unknown) {
			return {
				start: mocks.bridgeStartMock,
				stop: mocks.bridgeStopMock,
				onTextEvent: mocks.bridgeOnTextEventMock,
				getRoomAlias: vi.fn(),
				sendText: vi.fn(),
				setTyping: vi.fn(),
			};
		});
		mocks.MockSupervisor.mockImplementation(function (this: unknown) {
			return {
				handleEnvelope: mocks.supervisorHandleEnvelopeMock,
				dispatchProactiveJob: mocks.supervisorDispatchProactiveMock,
				shutdown: mocks.supervisorShutdownMock,
			};
		});
		mocks.MockScheduler.mockImplementation(function (this: unknown) {
			return {
				start: mocks.schedulerStartMock,
				stop: mocks.schedulerStopMock,
			};
		});
		mocks.loadSchedulerStateMock.mockReturnValue({});
		mocks.saveSchedulerStateMock.mockReturnValue(undefined);
		mocks.collectScheduledJobsMock.mockReturnValue([]);
		mocks.matrixCredentialsPathMock.mockReturnValue("/tmp/matrix.json");
		mocks.matrixAgentCredentialsPathMock.mockImplementation((agentId: string) => `/tmp/${agentId}.json`);
		mocks.readFileSyncMock.mockReturnValue(defaultCredentials);
		mocks.bridgeStartMock.mockResolvedValue(undefined);
		mocks.bridgeStopMock.mockReturnValue(undefined);
		mocks.bridgeOnTextEventMock.mockReturnValue(undefined);
		mocks.supervisorShutdownMock.mockResolvedValue(undefined);
		mocks.withRetryMock.mockImplementation(async (fn: () => Promise<void>) => {
			await fn();
		});
	});

	afterEach(() => {
		processOnSpy.mockClear();
	});

	it("starts the unified runtime with a default host agent when no valid agent definitions exist", async () => {
		mocks.loadRuntimeAgentsMock.mockReturnValue({
			agents: [
				{
					id: "host",
					name: "Pi",
					instructionsPath: "<builtin>",
					matrix: { userId: "@pi:nixpi", autojoin: true },
					respond: { mode: "host" },
				},
			],
			errors: ["bad overlay"],
		});

		await import("../../core/daemon/index.js");

		expect(mocks.logWarnMock).toHaveBeenCalledWith("skipping invalid agent definition", { error: "bad overlay" });
		expect(mocks.MockBridge).toHaveBeenCalledWith(
			expect.objectContaining({
				identities: expect.arrayContaining([
					expect.objectContaining({ id: "host" }),
				]),
			}),
		);
		expect(mocks.MockSupervisor).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionBaseDir: `${homeDir}/.pi/sessions/nixpi-rooms`,
			}),
		);
		expect(mocks.withRetryMock).toHaveBeenCalledTimes(1);
		expect(mocks.bridgeStartMock).toHaveBeenCalledTimes(1);
	});

	it("starts the multi-agent runtime when valid agent definitions exist", async () => {
		mocks.loadRuntimeAgentsMock.mockReturnValue({
			agents: [
				{ id: "ops", matrix: { userId: "@ops:nixpi", autojoin: true }, respond: { mode: "host" } },
				{ id: "support", matrix: { userId: "@support:nixpi", autojoin: true }, respond: { mode: "silent" } },
			],
			errors: [],
		});
		mocks.readFileSyncMock.mockImplementation((path: string) => {
			if (path === "/tmp/matrix.json") return defaultCredentials;
			return JSON.stringify({ homeserver: "http://matrix", accessToken: "tok", userId: "@ops:nixpi" });
		});

		const bootstrapModule = "../../core/daemon/index.js?multi";
		await import(bootstrapModule);

		expect(mocks.MockSupervisor).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionBaseDir: `${homeDir}/.pi/sessions/nixpi-rooms`,
			}),
		);
		expect(mocks.withRetryMock).toHaveBeenCalledTimes(1);
		expect(mocks.bridgeStartMock).toHaveBeenCalledTimes(1);
	});
});
