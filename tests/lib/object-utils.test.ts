import { describe, expect, it } from "vitest";
import { parseRef } from "../../lib/object-utils.js";

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
