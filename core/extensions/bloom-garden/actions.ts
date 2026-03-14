/**
 * Handler / business logic for bloom-garden.
 * Package helpers, directory setup, and tool handlers.
 */
import fs from "node:fs";
import os from "node:os";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { safePath } from "../../lib/filesystem.js";
import { stringifyFrontmatter } from "../../lib/frontmatter.js";
import {
	generateAgentInstructionsMarkdown,
	type MatrixCredentials,
	matrixAgentCredentialsPath,
	matrixCredentialsPath,
	provisionMatrixAgentAccount,
} from "../../lib/matrix.js";
import { errorResult, nowIso, truncate } from "../../lib/shared.js";
import { readBlueprintVersions } from "./actions-blueprints.js";

const BLOOM_DIRS = ["Persona", "Skills", "Evolutions", "Objects", "Agents", "audit"];

// --- Package helpers ---

export function getPackageDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6; i += 1) {
		if (fs.existsSync(path.join(dir, "package.json"))) return dir;
		dir = path.dirname(dir);
	}
	return process.cwd();
}

export function getPackageVersion(packageDir: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));
		return (pkg.version as string) ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}

// --- Directory setup ---

export function ensureBloom(bloomDir: string): void {
	for (const dir of BLOOM_DIRS) {
		fs.mkdirSync(path.join(bloomDir, dir), { recursive: true });
	}
}

// --- Tool handlers ---

export function handleGardenStatus(bloomDir: string) {
	const lines: string[] = [`Bloom: ${bloomDir}`, ""];

	const versions = readBlueprintVersions(bloomDir);
	lines.push(`Package version: ${versions.packageVersion}`);
	lines.push(`Seeded blueprints: ${Object.keys(versions.seeded).length}`);

	const updates = Object.keys(versions.updatesAvailable);
	if (updates.length > 0) {
		lines.push(`Updates available: ${updates.join(", ")}`);
	}

	return {
		content: [{ type: "text" as const, text: truncate(lines.join("\n")) }],
		details: {},
	};
}

export function handleSkillCreate(bloomDir: string, params: { name: string; description: string; content: string }) {
	let skillDir: string;
	try {
		skillDir = safePath(bloomDir, "Skills", params.name);
	} catch {
		return errorResult("Path traversal blocked: invalid skill name");
	}
	const filepath = path.join(skillDir, "SKILL.md");

	if (fs.existsSync(filepath)) {
		return errorResult(`skill already exists: ${params.name}`);
	}

	fs.mkdirSync(skillDir, { recursive: true });
	const content = stringifyFrontmatter({ name: params.name, description: params.description }, `\n${params.content}\n`);
	fs.writeFileSync(filepath, content);

	return {
		content: [{ type: "text" as const, text: `created skill: ${params.name} at ${filepath}` }],
		details: {},
	};
}

export function handleSkillList(bloomDir: string) {
	const skillsDir = path.join(bloomDir, "Skills");
	if (!fs.existsSync(skillsDir)) {
		return { content: [{ type: "text" as const, text: "No skills directory found." }], details: {} };
	}

	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	const skills: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
		if (!fs.existsSync(skillFile)) continue;
		const raw = fs.readFileSync(skillFile, "utf-8");
		const descMatch = raw.match(/^description:\s*(.+)$/m);
		const desc = descMatch ? descMatch[1] : "(no description)";
		skills.push(`${entry.name} — ${desc}`);
	}

	const text = skills.length > 0 ? skills.join("\n") : "No skills found in Bloom.";
	return { content: [{ type: "text" as const, text }], details: {} };
}

export interface AgentCreateParams {
	id: string;
	name: string;
	username?: string;
	description: string;
	role_prompt: string;
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	respond_mode?: "host" | "mentioned" | "silent";
}

interface AgentCreateDeps {
	homeDir?: string;
	loadPrimaryMatrixConfig?: () => { homeserver: string; registrationToken: string };
	provision?: typeof provisionMatrixAgentAccount;
}

function loadPrimaryMatrixConfigFromDisk(homeDir = os.homedir()): { homeserver: string; registrationToken: string } {
	const pathToCreds =
		homeDir === os.homedir() ? matrixCredentialsPath() : path.join(homeDir, ".pi", "matrix-credentials.json");
	try {
		const raw = JSON.parse(fs.readFileSync(pathToCreds, "utf-8")) as MatrixCredentials;
		if (!raw.homeserver || !raw.registrationToken) {
			throw new Error("missing homeserver or registration token");
		}
		return { homeserver: raw.homeserver, registrationToken: raw.registrationToken };
	} catch {
		throw new Error(`No Matrix setup found at ${pathToCreds}`);
	}
}

export async function handleAgentCreate(bloomDir: string, params: AgentCreateParams, deps: AgentCreateDeps = {}) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(params.id)) {
		return errorResult(`invalid agent id: ${params.id} (expected kebab-case)`);
	}

	const username = params.username ?? params.id;
	if (!/^[a-z0-9][a-z0-9-]*$/.test(username)) {
		return errorResult(`invalid username: ${username} (expected lowercase letters, numbers, hyphens)`);
	}

	let agentDir: string;
	try {
		agentDir = safePath(bloomDir, "Agents", params.id);
	} catch {
		return errorResult("Path traversal blocked: invalid agent id");
	}

	const instructionsPath = path.join(agentDir, "AGENTS.md");
	const credentialsPath = matrixAgentCredentialsPath(params.id, deps.homeDir ?? os.homedir());
	if (fs.existsSync(instructionsPath) || fs.existsSync(credentialsPath)) {
		return errorResult(`agent already exists: ${params.id}`);
	}

	let setup: { homeserver: string; registrationToken: string };
	try {
		setup = deps.loadPrimaryMatrixConfig
			? deps.loadPrimaryMatrixConfig()
			: loadPrimaryMatrixConfigFromDisk(deps.homeDir);
	} catch (err) {
		return errorResult(String(err));
	}

	const provision = deps.provision ?? provisionMatrixAgentAccount;
	const result = await provision({
		homeserver: setup.homeserver,
		username,
		registrationToken: setup.registrationToken,
	});
	if (!result.ok) return errorResult(result.error);

	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
	fs.writeFileSync(credentialsPath, JSON.stringify(result.credentials, null, 2), { mode: 0o600 });
	fs.writeFileSync(
		instructionsPath,
		generateAgentInstructionsMarkdown({
			id: params.id,
			name: params.name,
			username,
			description: params.description,
			rolePrompt: params.role_prompt,
			...(params.model ? { model: params.model } : {}),
			...(params.thinking ? { thinking: params.thinking } : {}),
			...(params.respond_mode ? { respondMode: params.respond_mode } : {}),
		}),
	);

	return {
		content: [
			{
				type: "text" as const,
				text: `created agent: ${params.id}\nuser: ${result.credentials.userId}\ncredentials: ${credentialsPath}\ninstructions: ${instructionsPath}`,
			},
		],
		details: {
			agentId: params.id,
			userId: result.credentials.userId,
			credentialsPath,
			instructionsPath,
		},
	};
}

export function handlePersonaEvolve(
	bloomDir: string,
	params: { layer: string; slug: string; title: string; proposal: string },
) {
	const validLayers = ["SOUL", "BODY", "FACULTY", "SKILL"];
	if (!validLayers.includes(params.layer.toUpperCase())) {
		return errorResult(`invalid layer: ${params.layer} (expected: ${validLayers.join(", ")})`);
	}

	const evoDir = path.join(bloomDir, "Evolutions");
	fs.mkdirSync(evoDir, { recursive: true });

	const filepath = path.join(evoDir, `${params.slug}.pi.md`);
	if (fs.existsSync(filepath)) {
		return errorResult(`evolution already exists: ${params.slug}`);
	}

	const data: Record<string, unknown> = {
		type: "evolution",
		slug: params.slug,
		title: params.title,
		layer: params.layer.toUpperCase(),
		status: "proposed",
		risk: "low",
		area: "persona",
		created: nowIso(),
	};

	fs.writeFileSync(filepath, stringifyFrontmatter(data, `\n${params.proposal}\n`));

	return {
		content: [
			{
				type: "text" as const,
				text: `proposed persona evolution: ${params.slug}\nlayer: ${params.layer.toUpperCase()}\nstatus: proposed\n\nThe user must approve this evolution before it can be applied.`,
			},
		],
		details: {},
	};
}

/** Discover skill paths for dynamic loading. */
export function discoverSkillPaths(bloomDir: string): string[] | undefined {
	const skillsDir = path.join(bloomDir, "Skills");
	if (!fs.existsSync(skillsDir)) return undefined;
	return [skillsDir];
}
