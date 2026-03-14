import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../../core/lib/frontmatter.js";

describe("frontmatter roundtrip integration", () => {
	it("roundtrip preserves simple k/v", () => {
		const data = { title: "Test", status: "active", priority: "high" };
		const body = "Some content here.";
		const str = stringifyFrontmatter(data, body);
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual(data);
		expect(parsed.body).toBe(body);
	});

	it("roundtrip preserves arrays", () => {
		const data = { tags: ["alpha", "beta", "gamma"] };
		const body = "body text";
		const str = stringifyFrontmatter(data, body);
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual(data);
	});

	it("roundtrip preserves body content with multiple lines", () => {
		const data = { type: "note" };
		const body = "line 1\nline 2\nline 3";
		const str = stringifyFrontmatter(data, body);
		const parsed = parseFrontmatter(str);
		expect(parsed.body).toBe(body);
	});

	it("roundtrip preserves empty body", () => {
		const data = { key: "val" };
		const str = stringifyFrontmatter(data, "");
		const parsed = parseFrontmatter(str);
		expect(parsed.body).toBe("");
	});

	it("roundtrip handles colons in values", () => {
		const data = { url: "https://example.com" };
		const str = stringifyFrontmatter(data, "");
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual({ url: "https://example.com" });
	});
});
