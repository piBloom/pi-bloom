import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAgentDefinitions, loadAgentDefinitionsResult } from "../../core/daemon/agent-registry.js";

describe("loadAgentDefinitions", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		vi.restoreAllMocks();
	});

	function makeBloomDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "bloom-agents-"));
		tempDirs.push(dir);
		mkdirSync(join(dir, "Agents"), { recursive: true });
		return dir;
	}

	function writeAgent(bloomDir: string, agentId: string, content: string): void {
		const agentDir = join(bloomDir, "Agents", agentId);
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "AGENTS.md"), content);
	}

	it("loads a valid AGENTS.md file", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"planner",
			`---
id: planner
name: Planner
matrix:
  username: planner
  autojoin: true
model: anthropic/claude-sonnet-4-5
thinking: medium
respond:
  mode: mentioned
  allow_agent_mentions: true
  max_public_turns_per_root: 3
  cooldown_ms: 2000
description: Planning specialist
---
# Planner

Plan first.
`,
		);

		const agents = loadAgentDefinitions({ bloomDir });
		expect(agents).toHaveLength(1);
		expect(agents[0]).toEqual({
			id: "planner",
			name: "Planner",
			description: "Planning specialist",
			instructionsPath: join(bloomDir, "Agents", "planner", "AGENTS.md"),
			instructionsBody: "# Planner\n\nPlan first.\n",
			matrix: {
				username: "planner",
				userId: "@planner:bloom",
				autojoin: true,
			},
			model: "anthropic/claude-sonnet-4-5",
			thinking: "medium",
			respond: {
				mode: "mentioned",
				allowAgentMentions: true,
				maxPublicTurnsPerRoot: 3,
				cooldownMs: 2000,
			},
		});
	});

	it("applies defaults for optional respond fields", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"critic",
			`---
id: critic
name: Critic
matrix:
  username: critic
---
# Critic

Question assumptions.
`,
		);

		const agents = loadAgentDefinitions({ bloomDir });
		expect(agents[0]?.respond).toEqual({
			mode: "mentioned",
			allowAgentMentions: true,
			maxPublicTurnsPerRoot: 2,
			cooldownMs: 1500,
		});
		expect(agents[0]?.matrix).toEqual({
			username: "critic",
			userId: "@critic:bloom",
			autojoin: true,
		});
	});

	it("loads multiple agent directories", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"host",
			`---
id: host
name: Host
matrix:
  username: pi
respond:
  mode: host
---
# Host
`,
		);
		writeAgent(
			bloomDir,
			"planner",
			`---
id: planner
name: Planner
matrix:
  username: planner
---
# Planner
`,
		);

		const agents = loadAgentDefinitions({ bloomDir });
		expect(agents.map((agent) => agent.id)).toEqual(["host", "planner"]);
	});

	it("skips agents with missing id and records the error", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"planner",
			`---
name: Planner
matrix:
  username: planner
---
# Planner
`,
		);

		const result = loadAgentDefinitionsResult({ bloomDir });
		expect(result.agents).toEqual([]);
		expect(result.errors).toEqual([expect.stringContaining("missing required field 'id'")]);
	});

	it("skips agents with missing name and records the error", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"planner",
			`---
id: planner
matrix:
  username: planner
---
# Planner
`,
		);

		const result = loadAgentDefinitionsResult({ bloomDir });
		expect(result.agents).toEqual([]);
		expect(result.errors).toEqual([expect.stringContaining("missing required field 'name'")]);
	});

	it("skips agents with missing matrix.username and records the error", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"planner",
			`---
id: planner
name: Planner
matrix:
  autojoin: true
---
# Planner
`,
		);

		const result = loadAgentDefinitionsResult({ bloomDir });
		expect(result.agents).toEqual([]);
		expect(result.errors).toEqual([expect.stringContaining("missing required field 'matrix.username'")]);
	});

	it("loads valid agents even when another agent definition is malformed", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"host",
			`---
id: host
name: Host
matrix:
  username: pi
respond:
  mode: host
---
# Host
`,
		);
		writeAgent(
			bloomDir,
			"broken",
			`---
name: Broken
matrix:
  username: broken
---
# Broken
`,
		);

		const result = loadAgentDefinitionsResult({ bloomDir });
		expect(result.agents.map((agent) => agent.id)).toEqual(["host"]);
		expect(result.errors).toHaveLength(1);
	});

	it("uses provided server name when deriving Matrix user ids", () => {
		const bloomDir = makeBloomDir();
		writeAgent(
			bloomDir,
			"planner",
			`---
id: planner
name: Planner
matrix:
  username: planner
---
# Planner
`,
		);

		const agents = loadAgentDefinitions({ bloomDir, serverName: "homebox" });
		expect(agents[0]?.matrix.userId).toBe("@planner:homebox");
	});
});
