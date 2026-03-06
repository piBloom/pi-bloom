import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRef, resolveCreatePath } from "../../lib/object-utils.js";

// ---------------------------------------------------------------------------
// parseRef
// ---------------------------------------------------------------------------
describe("parseRef", () => {
	it("parses type/slug", () => {
		expect(parseRef("task/fix-bike")).toEqual({ type: "task", slug: "fix-bike" });
	});

	it("throws on missing slash", () => {
		expect(() => parseRef("noslash")).toThrow("invalid reference format");
	});

	it("uses first slash only for a/b/c", () => {
		expect(parseRef("a/b/c")).toEqual({ type: "a", slug: "b/c" });
	});

	it("handles type with empty slug", () => {
		expect(parseRef("type/")).toEqual({ type: "type", slug: "" });
	});
});

// ---------------------------------------------------------------------------
// resolveCreatePath
// ---------------------------------------------------------------------------
describe("resolveCreatePath", () => {
	const garden = "/garden";

	it("resolves to Projects/ when project is set", () => {
		const result = resolveCreatePath(garden, "my-task", { project: "myproj" });
		expect(result).toBe(path.join(garden, "Projects", "myproj", "my-task.md"));
	});

	it("resolves to Areas/ when area is set", () => {
		const result = resolveCreatePath(garden, "note", { area: "health" });
		expect(result).toBe(path.join(garden, "Areas", "health", "note.md"));
	});

	it("resolves to Inbox/ when neither project nor area", () => {
		const result = resolveCreatePath(garden, "quick", {});
		expect(result).toBe(path.join(garden, "Inbox", "quick.md"));
	});

	it("prefers project over area", () => {
		const result = resolveCreatePath(garden, "x", { project: "p", area: "a" });
		expect(result).toBe(path.join(garden, "Projects", "p", "x.md"));
	});

	it("throws on path traversal via slug", () => {
		expect(() => resolveCreatePath(garden, "../../.ssh/authorized_keys", {})).toThrow("Path traversal blocked");
	});

	it("throws on path traversal via project", () => {
		expect(() => resolveCreatePath(garden, "note", { project: "../../etc" })).toThrow("Path traversal blocked");
	});

	it("throws on path traversal via area", () => {
		expect(() => resolveCreatePath(garden, "note", { area: "../../../tmp" })).toThrow("Path traversal blocked");
	});
});
