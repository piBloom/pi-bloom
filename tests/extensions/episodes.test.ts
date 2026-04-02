import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	consolidateEpisodes,
	createEpisode,
	dayStamp,
	episodeRef,
	loadEpisodes,
	promoteEpisode,
	timestampSlug,
} from "../../core/pi/extensions/episodes/actions.js";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

let temp: TempNixPi;
let api: MockExtensionAPI;

beforeEach(async () => {
	temp = createTempNixPi();
	api = createMockExtensionAPI();
	const mod = await import("../../core/pi/extensions/episodes/index.js");
	mod.default(api as never);
});

afterEach(() => {
	temp.cleanup();
});

function getExecute(name: string) {
	const tool = api._registeredTools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`tool ${name} not found`);
	return tool.execute as (
		...args: unknown[]
	) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown>; isError?: boolean }>;
}

describe("episodes", () => {
	it("registers episodic tools", () => {
		expect(api._registeredTools.map((tool) => tool.name)).toEqual([
			"episode_create",
			"episode_list",
			"episode_promote",
			"episode_consolidate",
		]);
	});

	it("creates and lists episode files", async () => {
		const create = getExecute("episode_create");
		const list = getExecute("episode_list");

		const result = await create("call-1", {
			title: "Preference Observation",
			body: "User prefers concise examples.",
			kind: "observation",
			room: "room-abc",
			tags: ["user", "preference"],
		});

		expect(result.content[0].text).toContain("created episode/");

		const episodesDir = path.join(temp.nixPiDir, "Episodes");
		const files = fs.globSync("**/*.md", { cwd: episodesDir });
		expect(files).toHaveLength(1);

		const listResult = await list("call-2", { kind: "observation", limit: 10 });
		expect(listResult.content[0].text).toContain(".md");
	});

	it("promotes episodes into durable objects", async () => {
		const create = getExecute("episode_create");
		const promote = getExecute("episode_promote");

		const createResult = await create("call-1", {
			title: "Style Preference",
			body: "User prefers 2-space indentation.",
			kind: "observation",
			importance: "high",
			tags: ["typescript", "preference"],
		});
		const episodeId = String((createResult.details as { id: string }).id);

		const promoteResult = await promote("call-2", {
			episode_id: episodeId,
			target: {
				type: "preference",
				slug: "ts-style",
				title: "TypeScript Style",
			},
		});

		expect(promoteResult.content[0].text).toContain("promoted episode/");

		const objectPath = path.join(temp.nixPiDir, "Objects", "ts-style.md");
		expect(fs.existsSync(objectPath)).toBe(true);
		const objectRaw = fs.readFileSync(objectPath, "utf-8");
		expect(objectRaw).toContain("type: preference");
		expect(objectRaw).toContain("episode/");

		const episodeFiles = fs.globSync("**/*.md", { cwd: path.join(temp.nixPiDir, "Episodes") });
		const episodeRaw = fs.readFileSync(path.join(temp.nixPiDir, "Episodes", episodeFiles[0]), "utf-8");
		expect(episodeRaw).toContain("preference/ts-style");
	});

	it("can auto-promote during episode creation", async () => {
		const create = getExecute("episode_create");
		const result = await create(
			"call-1",
			{
				title: "Recovery Procedure",
				body: "Restart nixpi-chat.service, then verify the local chat runtime recovers.",
				kind: "resolution",
				importance: "high",
				tags: ["recovery", "procedure"],
				promote_to: {
					type: "procedure",
					slug: "chat-runtime-recovery",
					title: "Chat Runtime Recovery Procedure",
					scope: "project",
				},
			},
			undefined,
			undefined,
			createMockExtensionContext({ cwd: "/tmp/pi-nixpi" }),
		);

		expect(result.content[0].text).toContain("created episode/");
		expect(result.content[0].text).toContain("promoted episode/");

		const objectPath = path.join(temp.nixPiDir, "Objects", "chat-runtime-recovery.md");
		expect(fs.existsSync(objectPath)).toBe(true);
		const objectRaw = fs.readFileSync(objectPath, "utf-8");
		expect(objectRaw).toContain("scope: project");
		expect(objectRaw).toContain("scope_value: pi-nixpi");
	});

	it("proposes and applies conservative episode consolidation", async () => {
		const create = getExecute("episode_create");
		const consolidate = getExecute("episode_consolidate");

		await create("call-1", {
			title: "CLI Style Preference",
			body: "User prefers concise CLI examples and 2-space indentation.",
			kind: "observation",
			importance: "high",
			tags: ["preference", "typescript"],
		});
		await create("call-2", {
			title: "Speculative Note",
			body: "Maybe the user might prefer verbose explanations.",
			kind: "observation",
			importance: "high",
			tags: ["preference"],
		});

		const proposed = await consolidate("call-3", { mode: "propose", limit: 10 });
		expect(proposed.content[0].text).toContain("episode/");
		expect(proposed.content[0].text).toContain("preference/cli-style-preference");
		expect(proposed.content[0].text).not.toContain("speculative-note");

		const applied = await consolidate("call-4", { mode: "apply", limit: 10 });
		expect(applied.content[0].text).toContain("preference/cli-style-preference");

		const objectPath = path.join(temp.nixPiDir, "Objects", "cli-style-preference.md");
		expect(fs.existsSync(objectPath)).toBe(true);
	});

	it("preserves room scope metadata on promotion", async () => {
		const create = getExecute("episode_create");
		const promote = getExecute("episode_promote");

		const createResult = await create("call-1", {
			title: "Room Preference",
			body: "This room prefers short operational updates.",
			kind: "observation",
			importance: "high",
			room: "ops-room",
			tags: ["preference"],
		});
		const episodeId = String((createResult.details as { id: string }).id);

		await promote(
			"call-2",
			{
				episode_id: episodeId,
				target: {
					type: "preference",
					slug: "ops-room-preference",
					title: "Ops Room Preference",
				},
			},
			undefined,
			undefined,
			createMockExtensionContext({ cwd: "/tmp/pi-nixpi" }),
		);

		const objectPath = path.join(temp.nixPiDir, "Objects", "ops-room-preference.md");
		const objectRaw = fs.readFileSync(objectPath, "utf-8");
		expect(objectRaw).toContain("scope: room");
		expect(objectRaw).toContain("scope_value: ops-room");
	});

	it("episode_create returns success with minimal required params", async () => {
		const create = getExecute("episode_create");
		const result = await create("call-1", {
			title: "Minimal Episode",
			body: "Just the body.",
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("created episode/");
		expect(result.details).toHaveProperty("id");
		expect(result.details).toHaveProperty("path");
	});

	it("episode_list returns empty result with no episodes", async () => {
		const list = getExecute("episode_list");
		const result = await list("call-1", {});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toBe("No episodes found");
		expect(result.details).toEqual({ count: 0 });
	});

	it("episode_list returns count in details after episodes are created", async () => {
		const create = getExecute("episode_create");
		const list = getExecute("episode_list");

		// Use distinct rooms so the id slug differs even when timestamps match
		await create("call-1", { title: "Alpha", body: "First.", room: "room-alpha" });
		await create("call-2", { title: "Beta", body: "Second.", room: "room-beta" });

		const result = await list("call-3", { limit: 5 });
		const count = (result.details as { count: number }).count;
		expect(count).toBeGreaterThanOrEqual(1);
		expect(result.content[0].text).toContain(".md");
	});

	it("episode_promote returns error for nonexistent episode", async () => {
		const promote = getExecute("episode_promote");
		const result = await promote("call-1", {
			episode_id: "9999-01-01T00-00-00Z",
			target: { type: "fact", slug: "ghost" },
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("episode not found");
	});

	it("episode_consolidate returns no-candidates message when no episodes exist", async () => {
		const consolidate = getExecute("episode_consolidate");
		const result = await consolidate("call-1", { mode: "propose" });
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("No conservative promotion candidates found");
		expect(result.details).toEqual({ count: 0, applied: 0 });
	});
});

// ---------------------------------------------------------------------------
// dayStamp / timestampSlug / episodeRef helpers
// ---------------------------------------------------------------------------
describe("episode helper functions", () => {
	it("dayStamp extracts YYYY-MM-DD from ISO string", () => {
		expect(dayStamp("2025-06-15T12:30:00Z")).toBe("2025-06-15");
	});

	it("timestampSlug replaces colons with hyphens", () => {
		expect(timestampSlug("2025-06-15T12:30:00Z")).toBe("2025-06-15T12-30-00Z");
	});

	it("episodeRef formats episode reference string", () => {
		expect(episodeRef("2025-06-15T12-30-00Z")).toBe("episode/2025-06-15T12-30-00Z");
	});
});

// ---------------------------------------------------------------------------
// loadEpisodes — day filter and limit
// ---------------------------------------------------------------------------
describe("loadEpisodes filters", () => {
	it("only returns episodes from the specified day", () => {
		const result1 = createEpisode({ title: "Today's episode", body: "body" });
		expect(result1.isError).toBeFalsy();

		const id = (result1.details as { id: string }).id;
		const day = id.slice(0, 10);

		const loaded = loadEpisodes({ day });
		expect(loaded.length).toBeGreaterThanOrEqual(1);
		expect(loaded.every((e) => e.relpath.startsWith(day))).toBe(true);
	});

	it("returns no episodes for a non-matching day", () => {
		createEpisode({ title: "Episode", body: "body" });
		const loaded = loadEpisodes({ day: "1900-01-01" });
		expect(loaded).toHaveLength(0);
	});

	it("respects the limit parameter", () => {
		for (let i = 0; i < 5; i++) {
			createEpisode({ title: `Episode ${i}`, body: "body", room: `room-${i}` });
		}
		const loaded = loadEpisodes({ limit: 2 });
		expect(loaded).toHaveLength(2);
	});

	it("clamps limit to minimum of 1", () => {
		createEpisode({ title: "Episode", body: "body" });
		const loaded = loadEpisodes({ limit: 0 });
		expect(loaded).toHaveLength(1);
	});

	it("filters by kind", () => {
		createEpisode({ title: "Observation", body: "body", kind: "observation", room: "room-obs" });
		createEpisode({ title: "Resolution", body: "body", kind: "resolution", room: "room-res" });
		const loaded = loadEpisodes({ kind: "resolution" });
		expect(loaded.every((e) => e.attributes.kind === "resolution")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// consolidateEpisodes — inferPromotionType behavior via propose
// ---------------------------------------------------------------------------
describe("consolidateEpisodes — promotion type inference", () => {
	it("infers preference type from tags", () => {
		createEpisode({
			title: "User prefers dark mode",
			body: "User said they prefer dark mode.",
			kind: "observation",
			importance: "high",
			tags: ["preference"],
		});
		const result = consolidateEpisodes({ mode: "propose" });
		expect(result.content[0].text).toContain("preference/");
	});

	it("infers procedure type from resolution kind", () => {
		createEpisode({
			title: "Recovery steps for nixpi-chat",
			body: "Restart the service and verify it comes back.",
			kind: "resolution",
			importance: "high",
			tags: ["recovery"],
		});
		const result = consolidateEpisodes({ mode: "propose" });
		expect(result.content[0].text).toContain("procedure/");
	});

	it("infers decision type from decision-point kind", () => {
		createEpisode({
			title: "Decided to use NixOS flakes",
			body: "The team decided to adopt flakes for reproducibility.",
			kind: "decision-point",
			importance: "high",
			tags: ["decision"],
		});
		const result = consolidateEpisodes({ mode: "propose" });
		expect(result.content[0].text).toContain("decision/");
	});

	it("skips low-importance episodes with unrecognised kind", () => {
		createEpisode({
			title: "Minor note",
			body: "Just a minor observation.",
			kind: "observation",
			importance: "low",
			tags: [],
		});
		const result = consolidateEpisodes({ mode: "propose" });
		expect(result.content[0].text).toContain("No conservative promotion candidates found");
	});

	it("skips speculative episodes even when high importance", () => {
		createEpisode({
			title: "Maybe the user prefers vim",
			body: "Maybe the user might prefer vim over emacs.",
			kind: "observation",
			importance: "high",
			tags: ["preference"],
		});
		const result = consolidateEpisodes({ mode: "propose" });
		expect(result.content[0].text).toContain("No conservative promotion candidates found");
	});

	it("skips already-promoted episodes", () => {
		const created = createEpisode({
			title: "CLI Style Preference",
			body: "User prefers concise CLI examples.",
			kind: "observation",
			importance: "high",
			tags: ["preference"],
		});
		const episodeId = (created.details as { id: string }).id;

		// Promote once to mark as derived
		promoteEpisode({
			episode_id: episodeId,
			target: { type: "preference", slug: "cli-style" },
		});

		// Consolidate — should no longer propose this episode
		const result = consolidateEpisodes({ mode: "propose" });
		expect(result.content[0].text).not.toContain("preference/cli-style");
	});
});
