import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
});

afterEach(() => {
	temp.cleanup();
});

describe("audit rotation", () => {
	it("deletes audit files older than 30 days on session_start", async () => {
		// Create audit directory structure
		const auditDir = join(temp.gardenDir, "audit");
		mkdirSync(auditDir, { recursive: true });

		const now = new Date();
		const DAY_MS = 24 * 60 * 60 * 1000;

		// Create old files (35 days ago)
		const oldDate = new Date(now.getTime() - 35 * DAY_MS);
		const oldName = `${oldDate.toISOString().slice(0, 10)}.jsonl`;
		writeFileSync(join(auditDir, oldName), '{"ts":"old","event":"tool_call","tool":"test","toolCallId":"1"}\n');

		// Create recent file (2 days ago)
		const recentDate = new Date(now.getTime() - 2 * DAY_MS);
		const recentName = `${recentDate.toISOString().slice(0, 10)}.jsonl`;
		writeFileSync(join(auditDir, recentName), '{"ts":"recent","event":"tool_call","tool":"test","toolCallId":"2"}\n');

		// Create non-matching file (should be ignored)
		writeFileSync(join(auditDir, "notes.txt"), "not an audit file");

		// Run extension session_start (triggers rotation)
		const mod = await import("../../core/extensions/bloom-audit/index.js");
		const api = createMockExtensionAPI();
		const ctx = createMockExtensionContext();
		mod.default(api as never);
		await api.fireEvent("session_start", {}, ctx);

		const remaining = readdirSync(auditDir);
		expect(remaining).not.toContain(oldName);
		expect(remaining).toContain(recentName);
		expect(remaining).toContain("notes.txt");
	});

	it("keeps files within the retention window", async () => {
		const auditDir = join(temp.gardenDir, "audit");
		mkdirSync(auditDir, { recursive: true });

		const now = new Date();
		const DAY_MS = 24 * 60 * 60 * 1000;

		// Create files at 1, 15, and 29 days ago (all within 30-day retention)
		for (const daysAgo of [1, 15, 29]) {
			const date = new Date(now.getTime() - daysAgo * DAY_MS);
			const name = `${date.toISOString().slice(0, 10)}.jsonl`;
			writeFileSync(join(auditDir, name), '{"ts":"x","event":"tool_call","tool":"t","toolCallId":"1"}\n');
		}

		const mod = await import("../../core/extensions/bloom-audit/index.js");
		const api = createMockExtensionAPI();
		const ctx = createMockExtensionContext();
		mod.default(api as never);
		await api.fireEvent("session_start", {}, ctx);

		const remaining = readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
		expect(remaining).toHaveLength(3);
	});
});
