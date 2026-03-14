import { readFileSync } from "node:fs";
/**
 * Pi Daemon — Matrix room agent supervisor.
 *
 * Runs in two modes:
 * - single-agent fallback: current `@pi:bloom` room daemon
 * - multi-agent mode: one Matrix client per configured agent, one Pi session per `(room, agent)`
 */
import os from "node:os";
import { join } from "node:path";
import {
	type MatrixAgentCredentials,
	type MatrixCredentials,
	matrixAgentCredentialsPath,
	matrixCredentialsPath,
} from "../lib/matrix.js";
import { sanitizeRoomAlias } from "../lib/room-alias.js";
import { createLogger } from "../lib/shared.js";
import { type AgentDefinition, loadAgentDefinitionsResult } from "./agent-registry.js";
import { AgentSupervisor } from "./agent-supervisor.js";
import { startWithRetry } from "./lifecycle.js";
import { createMultiAgentRuntime } from "./multi-agent-runtime.js";
import { handleRoomProcessError, type RoomFailureState } from "./room-failures.js";
import { createSingleAgentRuntime } from "./single-agent-runtime.js";
import type { MatrixBridge } from "./contracts/matrix.js";
import type { MatrixTextEvent } from "./contracts/matrix.js";
import type { SessionEvent } from "./contracts/session.js";
import type { BloomSessionLike } from "./contracts/session.js";
import { MatrixJsSdkBridge } from "./runtime/matrix-js-sdk-bridge.js";
import { PiRoomSession, type PiRoomSessionOptions } from "./runtime/pi-room-session.js";
import { loadSchedulerState, saveSchedulerState } from "./proactive.js";

const log = createLogger("pi-daemon");

const IDLE_TIMEOUT_MS = Number.parseInt(process.env.BLOOM_DAEMON_IDLE_TIMEOUT_MS ?? "", 10) || 15 * 60 * 1000;
const SESSION_BASE = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const STORAGE_PATH = join(os.homedir(), ".pi", "pi-daemon", "matrix-state.json");
const SCHEDULER_STATE_PATH = join(os.homedir(), ".pi", "pi-daemon", "scheduler-state.json");
const MATRIX_AGENT_STORAGE_DIR = join(os.homedir(), ".pi", "pi-daemon", "matrix-agents");
const DEFAULT_MATRIX_IDENTITY = "default";
const TYPING_TIMEOUT_MS = 30_000;
const TYPING_REFRESH_MS = 20_000;

const ROOM_FAILURE_WINDOW_MS = 60_000;
const ROOM_FAILURE_THRESHOLD = 3;
const ROOM_QUARANTINE_MS = 5 * 60_000;

async function main(): Promise<void> {
	log.info("starting pi-daemon", { idleTimeoutMs: IDLE_TIMEOUT_MS });

	const { agents, errors } = loadAgentDefinitionsResult();
	for (const error of errors) {
		log.warn("skipping invalid agent definition", { error });
	}
	if (agents.length === 0) {
		log.info("no valid multi-agent definitions found, using single-agent fallback", {
			invalidDefinitions: errors.length,
		});
		await runSingleAgentDaemon();
		return;
	}

	log.info("multi-agent definitions found, starting supervisor", {
		agents: agents.map((agent) => agent.id),
	});
	await runMultiAgentDaemon(agents);
}

async function runMultiAgentDaemon(agents: readonly AgentDefinition[]): Promise<void> {
	const runtime = createMultiAgentRuntime({
		agents,
		sessionBaseDir: SESSION_BASE,
		idleTimeoutMs: IDLE_TIMEOUT_MS,
		matrixAgentStorageDir: MATRIX_AGENT_STORAGE_DIR,
		loadAgentCredentials: loadAgentMatrixCredentials,
		loadSchedulerState: () => loadSchedulerState(SCHEDULER_STATE_PATH),
		saveSchedulerState: (state) => {
			try {
				saveSchedulerState(SCHEDULER_STATE_PATH, state);
			} catch (error) {
				log.warn("failed to persist scheduler state", { error: String(error) });
			}
		},
		onSchedulerError: (job, error) => {
			log.warn("proactive job failed", {
				jobId: job.jobId,
				agentId: job.agentId,
				roomId: job.roomId,
				kind: job.kind,
				error: String(error),
			});
		},
	});
	async function shutdown(signal: string): Promise<void> {
		log.info("shutting down", { signal, mode: "multi-agent" });
		await runtime.stop();
		await new Promise((r) => setTimeout(r, 100));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await startWithRetry(
		async () => {
			await runtime.start();
			log.info("pi-daemon running", {
				mode: "multi-agent",
				agents: agents.map((agent) => agent.id),
				proactiveJobs: runtime.proactiveJobs,
			});
		},
		async () => {
			await runtime.stop();
		},
		{
			onRetry: (error, retryDelay) => {
				log.error("failed to start daemon transport, retrying", {
					error: String(error),
					retryMs: retryDelay,
				});
			},
		},
	);
}

async function runSingleAgentDaemon(): Promise<void> {
	const runtime = createSingleAgentRuntime({
		storagePath: STORAGE_PATH,
		sessionBaseDir: SESSION_BASE,
		idleTimeoutMs: IDLE_TIMEOUT_MS,
		roomFailureWindowMs: ROOM_FAILURE_WINDOW_MS,
		roomFailureThreshold: ROOM_FAILURE_THRESHOLD,
		roomQuarantineMs: ROOM_QUARANTINE_MS,
		credentials: loadPrimaryMatrixCredentials(),
	});

	async function shutdown(signal: string): Promise<void> {
		log.info("shutting down", { signal, mode: "single-agent" });
		await runtime.stop();
		await new Promise((r) => setTimeout(r, 5000));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await runtime.start();
	log.info("pi-daemon running", { mode: "single-agent" });
}

function loadPrimaryMatrixCredentials(): MatrixCredentials {
	const path = matrixCredentialsPath();
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MatrixCredentials;
	} catch {
		throw new Error(`No credentials at ${path}`);
	}
}

function loadAgentMatrixCredentials(agentId: string): MatrixAgentCredentials {
	const path = matrixAgentCredentialsPath(agentId);
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MatrixAgentCredentials;
	} catch {
		throw new Error(`No Matrix credentials at ${path}`);
	}
}

main().catch((err) => {
	log.error("fatal error", { error: String(err) });
	process.exit(1);
});
