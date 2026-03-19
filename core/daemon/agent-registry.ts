import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getBloomDir } from "../lib/filesystem.js";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { isSupportedCronExpression } from "./scheduler.js";

export interface AgentDefinition {
	id: string;
	name: string;
	description?: string;
	instructionsPath: string;
	instructionsBody: string;
	matrix: {
		username: string;
		userId: string;
		autojoin: boolean;
	};
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	respond: {
		mode: "host" | "mentioned" | "silent";
		allowAgentMentions: boolean;
		maxPublicTurnsPerRoot: number;
		cooldownMs: number;
	};
	tools?: {
		allow?: string[];
		deny?: string[];
	};
	proactive?: {
		jobs: ProactiveJobDefinition[];
	};
}

export interface ProactiveJobDefinition {
	id: string;
	kind: "heartbeat" | "cron";
	room: string;
	prompt: string;
	intervalMinutes?: number;
	cron?: string;
	quietIfNoop?: boolean;
	noOpToken?: string;
}

export interface LoadAgentDefinitionsOptions {
	bloomDir?: string;
	serverName?: string;
}

export interface LoadAgentDefinitionsResult {
	agents: AgentDefinition[];
	errors: string[];
}

const DEFAULT_SERVER_NAME = "bloom";
const DEFAULT_RESPOND_MODE = "mentioned";
const DEFAULT_ALLOW_AGENT_MENTIONS = true;
const DEFAULT_MAX_PUBLIC_TURNS_PER_ROOT = 2;
const DEFAULT_COOLDOWN_MS = 1500;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const RESPOND_MODES = ["host", "mentioned", "silent"] as const;

const ProactiveJobSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	kind: Type.Union([Type.Literal("heartbeat"), Type.Literal("cron")]),
	room: Type.String({ minLength: 1 }),
	prompt: Type.String({ minLength: 1 }),
	interval_minutes: Type.Optional(Type.Number()),
	cron: Type.Optional(Type.String()),
	quiet_if_noop: Type.Optional(Type.Boolean()),
	no_op_token: Type.Optional(Type.String()),
});

const AgentFrontmatterSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
	description: Type.Optional(Type.String()),
	matrix: Type.Object({
		username: Type.String({ minLength: 1 }),
		autojoin: Type.Optional(Type.Boolean()),
	}),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(Type.Union(THINKING_LEVELS.map((level) => Type.Literal(level)))),
	respond: Type.Optional(
		Type.Object({
			mode: Type.Optional(Type.Union(RESPOND_MODES.map((mode) => Type.Literal(mode)))),
			allow_agent_mentions: Type.Optional(Type.Boolean()),
			max_public_turns_per_root: Type.Optional(Type.Number()),
			cooldown_ms: Type.Optional(Type.Number()),
		}),
	),
	tools: Type.Optional(
		Type.Object({
			allow: Type.Optional(Type.Array(Type.String())),
			deny: Type.Optional(Type.Array(Type.String())),
		}),
	),
	proactive: Type.Optional(
		Type.Object({
			jobs: Type.Optional(Type.Array(ProactiveJobSchema)),
		}),
	),
});

type AgentFrontmatter = Static<typeof AgentFrontmatterSchema>;
type ProactiveJobFrontmatter = Static<typeof ProactiveJobSchema>;

export function loadAgentDefinitions(options: LoadAgentDefinitionsOptions = {}): AgentDefinition[] {
	return loadAgentDefinitionsResult(options).agents;
}

export function loadAgentDefinitionsResult(options: LoadAgentDefinitionsOptions = {}): LoadAgentDefinitionsResult {
	const bloomDir = options.bloomDir ?? getBloomDir();
	const serverName = options.serverName ?? DEFAULT_SERVER_NAME;
	const agentsDir = join(bloomDir, "Agents");
	if (!existsSync(agentsDir)) return { agents: [], errors: [] };

	const agentIds = readdirSync(agentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	const agents: AgentDefinition[] = [];
	const errors: string[] = [];
	for (const agentDirName of agentIds) {
		const instructionsPath = join(agentsDir, agentDirName, "AGENTS.md");
		if (!existsSync(instructionsPath)) continue;

		try {
			const raw = readFileSync(instructionsPath, "utf-8");
			const { attributes, body } = parseFrontmatter<AgentFrontmatter>(raw);
			agents.push(normalizeAgentDefinition(attributes, body, instructionsPath, serverName));
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	return { agents, errors };
}

function normalizeAgentDefinition(
	attributes: AgentFrontmatter,
	instructionsBody: string,
	instructionsPath: string,
	serverName: string,
): AgentDefinition {
	const normalized = parseAgentFrontmatter(attributes, instructionsPath);
	const autojoin = normalized.matrix.autojoin ?? true;

	return {
		id: normalized.id,
		name: normalized.name,
		...(normalized.description ? { description: normalized.description } : {}),
		instructionsPath,
		instructionsBody,
		matrix: {
			username: normalized.matrix.username,
			userId: `@${normalized.matrix.username}:${serverName}`,
			autojoin,
		},
		...(normalized.model ? { model: normalized.model } : {}),
		...(normalized.thinking ? { thinking: normalized.thinking } : {}),
		respond: {
			mode: normalized.respond?.mode ?? DEFAULT_RESPOND_MODE,
			allowAgentMentions: normalized.respond?.allow_agent_mentions ?? DEFAULT_ALLOW_AGENT_MENTIONS,
			maxPublicTurnsPerRoot: normalized.respond?.max_public_turns_per_root ?? DEFAULT_MAX_PUBLIC_TURNS_PER_ROOT,
			cooldownMs: normalized.respond?.cooldown_ms ?? DEFAULT_COOLDOWN_MS,
		},
		...(normalizeTools(normalized.tools) ? { tools: normalizeTools(normalized.tools) } : {}),
		...(normalizeProactive(normalized.proactive, instructionsPath)
			? { proactive: normalizeProactive(normalized.proactive, instructionsPath) }
			: {}),
	};
}

function parseAgentFrontmatter(attributes: unknown, instructionsPath: string): AgentFrontmatter {
	if (Value.Check(AgentFrontmatterSchema, attributes)) {
		return attributes;
	}

	const firstError = [...Value.Errors(AgentFrontmatterSchema, attributes)][0];
	if (!firstError) {
		throw new Error(`${instructionsPath}: invalid agent frontmatter`);
	}

	const field = formatFieldPath(firstError.path);
	if (firstError.message.includes("Expected required property")) {
		throw new Error(`${instructionsPath}: missing required field '${field}'`);
	}
	if (field === "thinking") {
		throw new Error(`${instructionsPath}: invalid thinking '${String(readPath(attributes, firstError.path))}'`);
	}
	if (field === "respond.mode") {
		throw new Error(`${instructionsPath}: invalid respond.mode '${String(readPath(attributes, firstError.path))}'`);
	}
	throw new Error(`${instructionsPath}: invalid ${field}`);
}

function normalizeTools(value: AgentFrontmatter["tools"]): AgentDefinition["tools"] | undefined {
	if (!value) return undefined;
	const allow = value.allow;
	const deny = value.deny;
	if (!allow && !deny) return undefined;
	return {
		...(allow ? { allow } : {}),
		...(deny ? { deny } : {}),
	};
}

function normalizeProactive(
	value: AgentFrontmatter["proactive"],
	instructionsPath: string,
): AgentDefinition["proactive"] {
	if (!value) return undefined;
	const rawJobs = value.jobs;
	if (rawJobs === undefined) return undefined;
	const jobs = rawJobs.map((rawJob, index) =>
		normalizeProactiveJob(rawJob, `${instructionsPath}: proactive.jobs[${index}]`),
	);
	const seen = new Set<string>();
	for (const job of jobs) {
		const key = `${job.room}::${job.id}`;
		if (seen.has(key)) {
			throw new Error(`${instructionsPath}: duplicate proactive job '${job.id}' for room '${job.room}'`);
		}
		seen.add(key);
	}
	return jobs.length > 0 ? { jobs } : undefined;
}

function normalizeProactiveJob(job: ProactiveJobFrontmatter, source: string): ProactiveJobDefinition {
	const common = {
		id: job.id,
		kind: job.kind,
		room: job.room,
		prompt: job.prompt,
		...getNoOpBehavior(job),
	};

	return job.kind === "heartbeat" ? normalizeHeartbeatJob(job, source, common) : normalizeCronJob(job, source, common);
}

function getNoOpBehavior(
	job: ProactiveJobFrontmatter,
): Partial<Pick<ProactiveJobDefinition, "quietIfNoop" | "noOpToken">> {
	return {
		...(typeof job.quiet_if_noop === "boolean" ? { quietIfNoop: job.quiet_if_noop } : {}),
		...(typeof job.no_op_token === "string" ? { noOpToken: job.no_op_token } : {}),
	};
}

function normalizeHeartbeatJob(
	job: ProactiveJobFrontmatter,
	source: string,
	common: Pick<ProactiveJobDefinition, "id" | "kind" | "room" | "prompt"> &
		Partial<Pick<ProactiveJobDefinition, "quietIfNoop" | "noOpToken">>,
): ProactiveJobDefinition {
	if (typeof job.interval_minutes !== "number" || !Number.isFinite(job.interval_minutes) || job.interval_minutes <= 0) {
		throw new Error(`${source}: invalid interval_minutes`);
	}
	return {
		...common,
		intervalMinutes: job.interval_minutes,
	};
}

function normalizeCronJob(
	job: ProactiveJobFrontmatter,
	source: string,
	common: Pick<ProactiveJobDefinition, "id" | "kind" | "room" | "prompt"> &
		Partial<Pick<ProactiveJobDefinition, "quietIfNoop" | "noOpToken">>,
): ProactiveJobDefinition {
	if (typeof job.cron !== "string" || !job.cron.trim()) {
		throw new Error(`${source}: invalid cron`);
	}
	if (!isSupportedCronExpression(job.cron)) {
		throw new Error(`${source}: unsupported cron`);
	}
	return {
		...common,
		cron: job.cron,
	};
}

function formatFieldPath(path: string): string {
	const cleaned = path.replace(/^\//, "").replaceAll("/", ".");
	return cleaned || "<root>";
}

function readPath(value: unknown, path: string): unknown {
	if (!path) return value;
	const segments = path.replace(/^\//, "").split("/").filter(Boolean);
	let current = value as Record<string, unknown> | unknown;
	for (const segment of segments) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}
