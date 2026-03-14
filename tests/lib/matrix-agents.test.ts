import { afterEach, describe, expect, it, vi } from "vitest";

import { parseFrontmatter } from "../../core/lib/frontmatter.js";
import {
	generateAgentInstructionsMarkdown,
	matrixAgentCredentialsDir,
	matrixAgentCredentialsPath,
	provisionMatrixAgentAccount,
} from "../../core/lib/matrix.js";

describe("matrixAgentCredentialsDir", () => {
	it("returns the per-agent credentials directory under .pi", () => {
		expect(matrixAgentCredentialsDir("/var/home/pi")).toBe("/var/home/pi/.pi/matrix-agents");
	});
});

describe("matrixAgentCredentialsPath", () => {
	it("returns the credential file path for an agent id", () => {
		expect(matrixAgentCredentialsPath("planner", "/var/home/pi")).toBe("/var/home/pi/.pi/matrix-agents/planner.json");
	});
});

describe("provisionMatrixAgentAccount", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns credentials on successful registration", async () => {
		const register = vi.fn().mockResolvedValue({
			ok: true,
			userId: "@planner:bloom",
			accessToken: "planner-token",
		});

		const result = await provisionMatrixAgentAccount({
			homeserver: "http://localhost:6167",
			username: "planner",
			registrationToken: "reg-token",
			password: "secret-pass",
			register,
		});

		expect(register).toHaveBeenCalledWith("http://localhost:6167", "planner", "secret-pass", "reg-token");
		expect(result).toEqual({
			ok: true,
			credentials: {
				homeserver: "http://localhost:6167",
				userId: "@planner:bloom",
				accessToken: "planner-token",
				password: "secret-pass",
				username: "planner",
			},
		});
	});

	it("propagates duplicate username errors", async () => {
		const register = vi.fn().mockResolvedValue({
			ok: false,
			error: "Username is already taken.",
		});

		const result = await provisionMatrixAgentAccount({
			homeserver: "http://localhost:6167",
			username: "planner",
			registrationToken: "reg-token",
			password: "secret-pass",
			register,
		});

		expect(result).toEqual({ ok: false, error: "Username is already taken." });
	});
});

describe("generateAgentInstructionsMarkdown", () => {
	it("creates a starter AGENTS.md with expected frontmatter and body", () => {
		const markdown = generateAgentInstructionsMarkdown({
			id: "planner",
			name: "Planner",
			username: "planner",
			description: "Breaks problems into steps and proposes plans.",
			rolePrompt: "Focus on decomposition and sequencing.",
			model: "anthropic/claude-sonnet-4-5",
			thinking: "medium",
			respondMode: "mentioned",
		});

		const parsed = parseFrontmatter(markdown);
		expect(parsed.attributes).toEqual({
			id: "planner",
			name: "Planner",
			matrix: {
				username: "planner",
				autojoin: true,
			},
			model: "anthropic/claude-sonnet-4-5",
			thinking: "medium",
			respond: {
				mode: "mentioned",
				allow_agent_mentions: true,
				max_public_turns_per_root: 2,
				cooldown_ms: 1500,
			},
			description: "Breaks problems into steps and proposes plans.",
		});
		expect(parsed.body).toContain("# Planner");
		expect(parsed.body).toContain("Focus on decomposition and sequencing.");
	});
});
