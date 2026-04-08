import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ensureNixPi,
	getPackageDir,
	handleNixPiStatus,
	handleSkillCreate,
	handleSkillList,
} from "../../core/pi/extensions/nixpi/actions.js";
import { handleUpdateBlueprints } from "../../core/pi/extensions/nixpi/actions-blueprints.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

let nixPiDir: string;

beforeEach(() => {
	nixPiDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-test-"));
});

afterEach(() => {
	fs.rmSync(nixPiDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ensureNixPi
// ---------------------------------------------------------------------------
describe("ensureNixPi", () => {
	it("creates all required subdirectories", () => {
		ensureNixPi(nixPiDir);
		for (const dir of ["Persona", "Skills", "Evolutions", "audit"]) {
			expect(fs.existsSync(path.join(nixPiDir, dir))).toBe(true);
		}
	});

	it("is idempotent — calling twice does not throw", () => {
		ensureNixPi(nixPiDir);
		expect(() => ensureNixPi(nixPiDir)).not.toThrow();
	});
});

describe("nixpi extension", () => {
	it("shows usage for /nixpi without arguments instead of opening an interaction prompt", async () => {
		vi.resetModules();
		const api = createMockExtensionAPI();
		const mod = await import("../../core/pi/extensions/nixpi/index.js");
		mod.default(api as never);

		const ctx = createMockExtensionContext({ hasUI: true });
		const command = api._registeredCommands.find((entry) => entry.name === "nixpi") as unknown as {
			handler: (args: string, ctx: ReturnType<typeof createMockExtensionContext>) => Promise<void>;
		};

		await command.handler("", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /nixpi init | status | update-blueprints", "info");
	});
});

// ---------------------------------------------------------------------------
// getPackageDir
// ---------------------------------------------------------------------------
describe("getPackageDir", () => {
	it("returns a non-empty string", () => {
		const dir = getPackageDir();
		expect(typeof dir).toBe("string");
		expect(dir.length).toBeGreaterThan(0);
	});

	it("returns a path that exists", () => {
		const dir = getPackageDir();
		expect(fs.existsSync(dir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// handleNixPiStatus
// ---------------------------------------------------------------------------
describe("handleNixPiStatus", () => {
	it("returns content containing the NixPI dir path", () => {
		ensureNixPi(nixPiDir);
		const result = handleNixPiStatus(nixPiDir);
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain(nixPiDir);
	});

	it("returns a details object", () => {
		ensureNixPi(nixPiDir);
		const result = handleNixPiStatus(nixPiDir);
		expect(result.details).toBeDefined();
	});

	it("shows package version line", () => {
		ensureNixPi(nixPiDir);
		const result = handleNixPiStatus(nixPiDir);
		expect(result.content[0].text).toContain("Package version:");
	});
});

// ---------------------------------------------------------------------------
// handleSkillCreate
// ---------------------------------------------------------------------------
describe("handleSkillCreate", () => {
	beforeEach(() => {
		ensureNixPi(nixPiDir);
	});

	it("creates a SKILL.md file at the expected path", () => {
		const result = handleSkillCreate(nixPiDir, {
			name: "my-skill",
			description: "A test skill",
			content: "# My Skill\n\nDo things.",
		});
		expect(result.content[0].text).toContain("created skill: my-skill");
		const skillFile = path.join(nixPiDir, "Skills", "my-skill", "SKILL.md");
		expect(fs.existsSync(skillFile)).toBe(true);
	});

	it("writes name and description into the frontmatter", () => {
		handleSkillCreate(nixPiDir, {
			name: "scoped-skill",
			description: "Scoped description",
			content: "Body text",
		});
		const raw = fs.readFileSync(path.join(nixPiDir, "Skills", "scoped-skill", "SKILL.md"), "utf-8");
		expect(raw).toContain("name: scoped-skill");
		expect(raw).toContain("description: Scoped description");
		expect(raw).toContain("Body text");
	});

	it("returns an error result when the skill already exists", () => {
		handleSkillCreate(nixPiDir, { name: "dup-skill", description: "first", content: "" });
		const result = handleSkillCreate(nixPiDir, { name: "dup-skill", description: "second", content: "" });
		expect(result.content[0].text).toContain("already exists");
	});

	it("blocks path traversal in skill name that escapes NixPI dir", () => {
		const result = handleSkillCreate(nixPiDir, { name: "../../escape", description: "bad", content: "" });
		expect(result.content[0].text).toContain("Path traversal blocked");
	});
});

// ---------------------------------------------------------------------------
// handleSkillList
// ---------------------------------------------------------------------------
describe("handleSkillList", () => {
	it("returns message when Skills directory does not exist", () => {
		// nixPiDir exists but Skills subdir has not been created
		const result = handleSkillList(nixPiDir);
		expect(result.content[0].text).toContain("No skills directory found");
	});

	it("returns message when Skills directory is empty", () => {
		fs.mkdirSync(path.join(nixPiDir, "Skills"), { recursive: true });
		const result = handleSkillList(nixPiDir);
		expect(result.content[0].text).toContain("No skills found");
	});

	it("lists skills with their descriptions", () => {
		ensureNixPi(nixPiDir);
		handleSkillCreate(nixPiDir, { name: "alpha", description: "Alpha skill", content: "" });
		handleSkillCreate(nixPiDir, { name: "beta", description: "Beta skill", content: "" });

		const result = handleSkillList(nixPiDir);
		expect(result.content[0].text).toContain("alpha");
		expect(result.content[0].text).toContain("Alpha skill");
		expect(result.content[0].text).toContain("beta");
		expect(result.content[0].text).toContain("Beta skill");
	});

	it("ignores entries without a SKILL.md file", () => {
		ensureNixPi(nixPiDir);
		// Create a directory without a SKILL.md
		fs.mkdirSync(path.join(nixPiDir, "Skills", "orphan"), { recursive: true });
		const result = handleSkillList(nixPiDir);
		expect(result.content[0].text).toContain("No skills found");
	});
});

describe("handleUpdateBlueprints", () => {
	it("updates persona files from core/pi/persona sources", () => {
		ensureNixPi(nixPiDir);

		const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-package-"));
		try {
			fs.mkdirSync(path.join(packageDir, "core", "pi", "persona"), { recursive: true });
			fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
			fs.writeFileSync(path.join(packageDir, "core", "pi", "persona", "SOUL.md"), "updated soul");
			fs.writeFileSync(path.join(nixPiDir, "Persona", "SOUL.md"), "old soul");
			fs.writeFileSync(
				path.join(nixPiDir, "blueprint-versions.json"),
				JSON.stringify({
					packageVersion: "1.0.0",
					seeded: { "persona/SOUL.md": "1.0.0" },
					seededHashes: { "persona/SOUL.md": "hash-old" },
					updatesAvailable: { "persona/SOUL.md": "1.2.3" },
				}),
			);

			const updatedCount = handleUpdateBlueprints(nixPiDir, packageDir);

			expect(updatedCount).toBe(1);
			expect(fs.readFileSync(path.join(nixPiDir, "Persona", "SOUL.md"), "utf-8")).toBe("updated soul");
		} finally {
			fs.rmSync(packageDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// workspace_status tool execute (via registered extension)
// ---------------------------------------------------------------------------

type NixPiStatusResult = { content: Array<{ type: string; text: string }>; details: unknown };
type NixPiStatusExecute = () => Promise<NixPiStatusResult>;

describe("nixpi_status tool execute", () => {
	let temp: TempNixPi;
	let api: ReturnType<typeof createMockExtensionAPI>;

	beforeEach(async () => {
		temp = createTempNixPi();
		vi.resetModules();
		api = createMockExtensionAPI();
		const mod = await import("../../core/pi/extensions/nixpi/index.js");
		mod.default(api as never);
	});

	afterEach(() => {
		temp.cleanup();
	});

	function getNixPiStatusExecute(): NixPiStatusExecute {
		const tool = api._registeredTools.find((t) => t.name === "nixpi_status");
		if (!tool) throw new Error("nixpi_status tool not found");
		return tool.execute as NixPiStatusExecute;
	}

	it("returns a result with content array containing a text item", async () => {
		expect(api._registeredTools.find((t) => t.name === "nixpi_status")).toBeDefined();
		const result = await getNixPiStatusExecute()();
		expect(result).toHaveProperty("content");
		expect(Array.isArray(result.content)).toBe(true);
		expect(result.content[0]).toHaveProperty("type", "text");
	});

	it("includes the NixPI dir path in the status text", async () => {
		const result = await getNixPiStatusExecute()();
		expect(result.content[0].text).toContain(temp.nixPiDir);
	});

	it("includes package version line in the status text", async () => {
		const result = await getNixPiStatusExecute()();
		expect(result.content[0].text).toContain("Package version:");
	});

	it("includes seeded blueprints count in the status text", async () => {
		const result = await getNixPiStatusExecute()();
		expect(result.content[0].text).toContain("Seeded blueprints:");
	});
});

// ---------------------------------------------------------------------------
// /nixpi command handler subcommands
// ---------------------------------------------------------------------------
describe("/nixpi command handler", () => {
	let temp: TempNixPi;
	let api: ReturnType<typeof createMockExtensionAPI>;

	beforeEach(async () => {
		temp = createTempNixPi();
		vi.resetModules();
		api = createMockExtensionAPI();
		const mod = await import("../../core/pi/extensions/nixpi/index.js");
		mod.default(api as never);
	});

	afterEach(() => {
		temp.cleanup();
	});

	function getCommandHandler() {
		const entry = api._registeredCommands.find((c) => c.name === "nixpi");
		if (!entry) throw new Error("nixpi command not registered");
		return entry.handler as (args: string, ctx: ReturnType<typeof createMockExtensionContext>) => Promise<void>;
	}

	it("registers the /nixpi command", () => {
		const entry = api._registeredCommands.find((c) => c.name === "nixpi");
		expect(entry).toBeDefined();
	});

	it("status subcommand sends a user message via pi.sendUserMessage", async () => {
		const handler = getCommandHandler();
		const ctx = createMockExtensionContext({ hasUI: true });
		await handler("status", ctx);
		expect(api._sentMessages).toHaveLength(1);
		expect(api._sentMessages[0].message).toContain("nixpi_status");
	});

	it("init subcommand notifies with NixPI initialized", async () => {
		const handler = getCommandHandler();
		const ctx = createMockExtensionContext({ hasUI: true });
		await handler("init", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("NixPI initialized", "info");
	});

	it("init subcommand creates NixPI subdirectories", async () => {
		const handler = getCommandHandler();
		const ctx = createMockExtensionContext({ hasUI: true });
		await handler("init", ctx);
		for (const dir of ["Persona", "Skills", "Evolutions", "Objects", "Episodes", "Agents", "audit"]) {
			expect(fs.existsSync(path.join(temp.nixPiDir, dir))).toBe(true);
		}
	});

	it("update-blueprints subcommand notifies when blueprints are up to date", async () => {
		const handler = getCommandHandler();
		const ctx = createMockExtensionContext({ hasUI: true });
		await handler("update-blueprints", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringMatching(/All blueprints are up to date|Updated \d+ blueprint/),
			"info",
		);
	});

	it("unknown subcommand shows usage hint", async () => {
		const handler = getCommandHandler();
		const ctx = createMockExtensionContext({ hasUI: true });
		await handler("unknown-cmd", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /nixpi init | status | update-blueprints", "info");
	});
});
