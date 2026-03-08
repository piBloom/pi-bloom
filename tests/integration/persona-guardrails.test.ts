import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
	// Seed persona files so loadPersona doesn't fail
	const personaDir = join(temp.gardenDir, "Persona");
	mkdirSync(personaDir, { recursive: true });
	for (const file of ["SOUL.md", "BODY.md", "FACULTY.md", "SKILL.md"]) {
		writeFileSync(join(personaDir, file), `# ${file}\ntest content`);
	}
});

afterEach(() => {
	temp.cleanup();
});

async function setupPersonaExtension(guardrailsYaml?: string) {
	if (guardrailsYaml) {
		mkdirSync(temp.gardenDir, { recursive: true });
		writeFileSync(join(temp.gardenDir, "guardrails.yaml"), guardrailsYaml);
	}

	// Each mod.default(api) call creates fresh closures (guardrails starts undefined)
	const mod = await import("../../extensions/bloom-persona/index.js");
	const api = createMockExtensionAPI();
	const ctx = createMockExtensionContext();
	mod.default(api as never);
	await api.fireEvent("session_start", {}, ctx);
	return { api, ctx };
}

const DEFAULT_GUARDRAILS = `
rules:
  - tool: bash
    action: block
    patterns:
      - pattern: '\\brm\\s+-rf\\s+\\/'
        label: "rm -rf /"
      - pattern: '\\bshutdown\\b'
        label: "shutdown"
      - pattern: '\\breboot\\b'
        label: "reboot"
      - pattern: '\\bmkfs\\b'
        label: "mkfs (filesystem format)"
`;

describe("persona guardrail blocking via tool_call handler", () => {
	it("blocks rm -rf / via tool_call event", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "rm -rf /" },
		});
		expect(result).toEqual({ block: true, reason: "Blocked dangerous command: rm -rf /" });
	});

	it("allows safe bash commands", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "ls -la" },
		});
		expect(result).toBeUndefined();
	});

	it("ignores non-bash tools", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "read_file",
			input: { path: "/etc/passwd" },
		});
		expect(result).toBeUndefined();
	});

	it("blocks shutdown command", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "shutdown -h now" },
		});
		expect(result).toEqual({ block: true, reason: "Blocked dangerous command: shutdown" });
	});

	it("blocks reboot command", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "reboot" },
		});
		expect(result).toEqual({ block: true, reason: "Blocked dangerous command: reboot" });
	});

	it("blocks mkfs command", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "mkfs.ext4 /dev/sda1" },
		});
		expect(result).toEqual({
			block: true,
			reason: "Blocked dangerous command: mkfs (filesystem format)",
		});
	});

	it("blocks normalized whitespace bypass attempts", async () => {
		const { api } = await setupPersonaExtension(DEFAULT_GUARDRAILS);
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "rm  -rf  /" },
		});
		expect(result).toEqual({ block: true, reason: "Blocked dangerous command: rm -rf /" });
	});

	it("falls back to package guardrails.yaml when garden copy missing", async () => {
		// Don't seed guardrails in garden — extension should fall back to package root
		const { api } = await setupPersonaExtension();
		const result = await api.fireEvent("tool_call", {
			toolName: "bash",
			input: { command: "rm -rf /" },
		});
		expect(result).toEqual({ block: true, reason: "Blocked dangerous command: rm -rf /" });
	});
});
