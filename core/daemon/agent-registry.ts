import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBloomDir } from "../lib/filesystem.js";
import { parseFrontmatter } from "../lib/frontmatter.js";

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
}

interface AgentFrontmatter extends Record<string, unknown> {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	matrix?: {
		username?: unknown;
		autojoin?: unknown;
	};
	model?: unknown;
	thinking?: unknown;
	respond?: {
		mode?: unknown;
		allow_agent_mentions?: unknown;
		max_public_turns_per_root?: unknown;
		cooldown_ms?: unknown;
	};
	tools?: {
		allow?: unknown;
		deny?: unknown;
	};
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
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const RESPOND_MODES = new Set(["host", "mentioned", "silent"]);

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
	const id = requireString(attributes.id, "id", instructionsPath);
	const name = requireString(attributes.name, "name", instructionsPath);
	const matrix = requireObject(attributes.matrix, "matrix", instructionsPath);
	const username = requireString(matrix.username, "matrix.username", instructionsPath);
	const autojoin = typeof matrix.autojoin === "boolean" ? matrix.autojoin : true;

	const respondObj = toRecord(attributes.respond);
	const respondMode = normalizeRespondMode(respondObj?.mode, instructionsPath);
	const allowAgentMentions =
		typeof respondObj?.allow_agent_mentions === "boolean"
			? respondObj.allow_agent_mentions
			: DEFAULT_ALLOW_AGENT_MENTIONS;
	const maxPublicTurnsPerRoot =
		typeof respondObj?.max_public_turns_per_root === "number"
			? respondObj.max_public_turns_per_root
			: DEFAULT_MAX_PUBLIC_TURNS_PER_ROOT;
	const cooldownMs = typeof respondObj?.cooldown_ms === "number" ? respondObj.cooldown_ms : DEFAULT_COOLDOWN_MS;

	return {
		id,
		name,
		...(typeof attributes.description === "string" ? { description: attributes.description } : {}),
		instructionsPath,
		instructionsBody,
		matrix: {
			username,
			userId: `@${username}:${serverName}`,
			autojoin,
		},
		...(typeof attributes.model === "string" ? { model: attributes.model } : {}),
		...(normalizeThinking(attributes.thinking, instructionsPath)
			? { thinking: normalizeThinking(attributes.thinking, instructionsPath) }
			: {}),
		respond: {
			mode: respondMode,
			allowAgentMentions,
			maxPublicTurnsPerRoot,
			cooldownMs,
		},
		...(normalizeTools(attributes.tools, instructionsPath)
			? { tools: normalizeTools(attributes.tools, instructionsPath) }
			: {}),
	};
}

function requireString(value: unknown, field: string, instructionsPath: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${instructionsPath}: missing required field '${field}'`);
	}
	return value;
}

function requireObject(value: unknown, field: string, instructionsPath: string): Record<string, unknown> {
	const obj = toRecord(value);
	if (!obj) throw new Error(`${instructionsPath}: missing required field '${field}'`);
	return obj;
}

function toRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function normalizeRespondMode(value: unknown, instructionsPath: string): "host" | "mentioned" | "silent" {
	if (value === undefined) return DEFAULT_RESPOND_MODE;
	if (typeof value !== "string" || !RESPOND_MODES.has(value)) {
		throw new Error(`${instructionsPath}: invalid respond.mode '${String(value)}'`);
	}
	return value as "host" | "mentioned" | "silent";
}

function normalizeThinking(value: unknown, instructionsPath: string): AgentDefinition["thinking"] | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !THINKING_LEVELS.has(value)) {
		throw new Error(`${instructionsPath}: invalid thinking '${String(value)}'`);
	}
	return value as AgentDefinition["thinking"];
}

function normalizeTools(
	value: AgentFrontmatter["tools"],
	instructionsPath: string,
): AgentDefinition["tools"] | undefined {
	const tools = toRecord(value);
	if (!tools) return undefined;

	const allow = normalizeStringArray(tools.allow, "tools.allow", instructionsPath);
	const deny = normalizeStringArray(tools.deny, "tools.deny", instructionsPath);
	if (!allow && !deny) return undefined;
	return {
		...(allow ? { allow } : {}),
		...(deny ? { deny } : {}),
	};
}

function normalizeStringArray(value: unknown, field: string, instructionsPath: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${instructionsPath}: invalid ${field}`);
	}
	return value;
}
