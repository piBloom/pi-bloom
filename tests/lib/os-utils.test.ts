import { describe, expect, it } from "vitest";
import { guardBloom, parseGithubSlugFromUrl, slugifyBranchPart } from "../../lib/os-utils.js";

// ---------------------------------------------------------------------------
// guardBloom
// ---------------------------------------------------------------------------
describe("guardBloom", () => {
	it("returns null for bloom- prefixed names", () => {
		expect(guardBloom("bloom-os")).toBeNull();
		expect(guardBloom("bloom-test")).toBeNull();
	});

	it("returns null for bloom names with numbers", () => {
		expect(guardBloom("bloom-svc1")).toBeNull();
		expect(guardBloom("bloom-v2-api")).toBeNull();
	});

	it("returns error for non-bloom names", () => {
		const result = guardBloom("not-bloom");
		expect(result).toContain("Security error");
	});

	it("returns error for empty string", () => {
		expect(guardBloom("")).not.toBeNull();
	});

	it("rejects shell metacharacters", () => {
		expect(guardBloom("bloom-;rm -rf /")).not.toBeNull();
		expect(guardBloom("bloom-$(whoami)")).not.toBeNull();
		expect(guardBloom("bloom-`id`")).not.toBeNull();
	});

	it("rejects path separators", () => {
		expect(guardBloom("bloom-../../etc")).not.toBeNull();
		expect(guardBloom("bloom-foo/bar")).not.toBeNull();
	});

	it("rejects spaces", () => {
		expect(guardBloom("bloom- evil")).not.toBeNull();
	});

	it("rejects uppercase letters", () => {
		expect(guardBloom("bloom-Foo")).not.toBeNull();
	});

	it("rejects bloom- with nothing after it", () => {
		expect(guardBloom("bloom-")).not.toBeNull();
	});

	it("rejects bloom- starting with hyphen", () => {
		expect(guardBloom("bloom--double")).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseGithubSlugFromUrl
// ---------------------------------------------------------------------------
describe("parseGithubSlugFromUrl", () => {
	it("parses SSH URL", () => {
		expect(parseGithubSlugFromUrl("git@github.com:owner/repo.git")).toBe("owner/repo");
	});

	it("parses HTTPS URL", () => {
		expect(parseGithubSlugFromUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
	});

	it("parses HTTPS URL without .git", () => {
		expect(parseGithubSlugFromUrl("https://github.com/owner/repo")).toBe("owner/repo");
	});

	it("parses ssh:// URL", () => {
		expect(parseGithubSlugFromUrl("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
	});

	it("returns null for non-github URL", () => {
		expect(parseGithubSlugFromUrl("https://gitlab.com/owner/repo")).toBeNull();
	});

	it("returns null for non-URL string", () => {
		expect(parseGithubSlugFromUrl("not a url")).toBeNull();
	});

	it("trims whitespace", () => {
		expect(parseGithubSlugFromUrl("  https://github.com/a/b  ")).toBe("a/b");
	});
});

// ---------------------------------------------------------------------------
// slugifyBranchPart
// ---------------------------------------------------------------------------
describe("slugifyBranchPart", () => {
	it("lowercases input", () => {
		expect(slugifyBranchPart("Hello")).toBe("hello");
	});

	it("replaces non-alphanumeric with hyphens", () => {
		expect(slugifyBranchPart("foo bar_baz")).toBe("foo-bar-baz");
	});

	it("strips leading and trailing hyphens", () => {
		expect(slugifyBranchPart("--hello--")).toBe("hello");
	});

	it("truncates to 48 characters", () => {
		const long = "a".repeat(60);
		expect(slugifyBranchPart(long)).toHaveLength(48);
	});

	it("handles special characters", () => {
		expect(slugifyBranchPart("feat/add-thing!@#")).toBe("feat-add-thing");
	});
});
