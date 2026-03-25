import { readFileSync } from "node:fs";
/**
 * Pi Daemon — Matrix room agent supervisor.
 *
 * Always runs through the multi-agent supervisor.
 * When no valid overlays exist, a default host agent is synthesized from the primary Pi account.
 */
import { join } from "node:path";
import { getDaemonStateDir, getPiDir } from "../lib/filesystem.js";
import {
	type MatrixAgentCredentials,
	type MatrixCredentials,
	matrixAgentCredentialsPath,
	matrixCredentialsPath,
} from "../lib/matrix.js";
import { createLogger } from "../lib/shared.js";
import type { AgentDefinition } from "./agent-registry.js";
import { loadRuntimeAgents } from "./agent-registry.js";
import { loadDaemonConfig } from "./config.js";
import { withRetry } from "../lib/retry.js";
import { AgentSupervisor, classifySender, extractMentions } from "./agent-supervisor.js";
import { collectScheduledJobs, loadSchedulerState, saveSchedulerState } from "./proactive.js";
import { MatrixJsSdkBridge } from "./runtime/matrix-js-sdk-bridge.js";
import { Scheduler } from "./scheduler.js";

const log = createLogger("nixpi-daemon");

const config = loadDaemonConfig();
const ROOM_SESSION_BASE = join(getPiDir(), "sessions", "nixpi-rooms");
const SCHEDULER_STATE_PATH = join(getDaemonStateDir(), "scheduler-state.json");

async function main(): Promise<void> {
	log.info("starting nixpi-daemon", { idleTimeoutMs: config.idleTimeoutMs });

	const credentials = loadPrimaryMatrixCredentials();
	const { agents, errors } = loadRuntimeAgents({
		primaryCredentials: credentials,
	});
	for (const error of errors) {
		log.warn("skipping invalid agent definition", { error });
	}
	const usingBuiltinHost = agents.length === 1 && agents[0]?.instructionsPath === "<builtin>";
	if (usingBuiltinHost) {
		log.info("no valid multi-agent definitions found, using default host agent", {
			invalidDefinitions: errors.length,
		});
	} else {
		log.info("multi-agent definitions found, starting supervisor", {
			agents: agents.map((agent) => agent.id),
		});
	}
	await runDaemon(
		agents,
		usingBuiltinHost
			? (agentId) => {
					if (agentId !== "host") {
						throw new Error(`No Matrix credentials at synthetic agent ${agentId}`);
					}
					return {
						homeserver: credentials.homeserver,
						userId: credentials.botUserId,
						accessToken: credentials.botAccessToken,
						password: credentials.botPassword,
						username: credentials.botUserId.slice(1, credentials.botUserId.indexOf(":")),
					};
				}
			: loadAgentMatrixCredentials,
	);
}

async function runDaemon(
	agents: readonly AgentDefinition[],
	loadAgentCredentials: (agentId: string) => MatrixAgentCredentials,
): Promise<void> {
	const { bridge, supervisor, scheduler, proactiveJobs } = bootstrap(agents, loadAgentCredentials);

	async function start(): Promise<void> {
		try {
			await bridge.start();
			scheduler?.start();
		} catch (error) {
			scheduler?.stop();
			await supervisor.shutdown();
			bridge.stop();
			throw error;
		}
	}

	async function stop(): Promise<void> {
		scheduler?.stop();
		await supervisor.shutdown();
		bridge.stop();
	}

	async function shutdown(signal: string): Promise<void> {
		log.info("shutting down", { signal, mode: "unified" });
		await stop();
		await new Promise((r) => setTimeout(r, 100));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await withRetry(
		async () => {
			await start();
			log.info("nixpi-daemon running", {
				mode: "unified",
				agents: agents.map((agent) => agent.id),
				proactiveJobs,
			});
		},
		{
			baseDelayMs: config.initialRetryDelayMs,
			maxDelayMs: config.maxRetryDelayMs,
			onError: async () => {
				await stop();
			},
			onRetry: (_attempt, retryDelay, error) => {
				log.error("failed to start daemon transport, retrying", {
					error: String(error),
					retryMs: retryDelay,
				});
			},
		},
	);
}

function bootstrap(
	agents: readonly AgentDefinition[],
	loadAgentCredentials: (agentId: string) => MatrixAgentCredentials,
) {
	const identities = agents.map((agent) => {
		const credentials = loadAgentCredentials(agent.id);
		return {
			id: agent.id,
			userId: agent.matrix.userId,
			homeserver: credentials.homeserver,
			accessToken: credentials.accessToken,
			autojoin: agent.matrix.autojoin,
		};
	});

	const bridge = new MatrixJsSdkBridge({ identities });

	const supervisor = new AgentSupervisor({
		agents,
		matrixBridge: bridge,
		sessionBaseDir: ROOM_SESSION_BASE,
		idleTimeoutMs: config.idleTimeoutMs,
	});

	bridge.onTextEvent((_identityId, event) => {
		const senderInfo = classifySender(event.senderUserId, "", agents);
		if (senderInfo.senderKind === "self") return;
		void supervisor.handleEnvelope({
			roomId: event.roomId,
			eventId: event.eventId,
			senderUserId: event.senderUserId,
			body: event.body,
			senderKind: senderInfo.senderKind,
			...(senderInfo.senderAgentId ? { senderAgentId: senderInfo.senderAgentId } : {}),
			mentions: extractMentions(event.body, agents),
			timestamp: event.timestamp,
		});
	});

	const jobs = collectScheduledJobs(agents);
	const scheduler =
		jobs.length > 0
			? new Scheduler({
					jobs,
					onTrigger: (job) => supervisor.dispatchProactiveJob(job),
					loadState: () => loadSchedulerState(SCHEDULER_STATE_PATH),
					saveState: (state) => {
						try {
							saveSchedulerState(SCHEDULER_STATE_PATH, state);
						} catch (error) {
							log.warn("failed to persist scheduler state", { error: String(error) });
						}
					},
					onError: (job, error) => {
						log.warn("proactive job failed", {
							jobId: job.jobId,
							agentId: job.agentId,
							roomId: job.roomId,
							kind: job.kind,
							error: String(error),
						});
					},
				})
			: null;

	return { bridge, supervisor, scheduler, proactiveJobs: jobs.length };
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
