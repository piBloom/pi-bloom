import { describe, expect, it } from "vitest";
import { getRemoteUrl, inferRepoUrl } from "../../core/lib/repo.js";

describe("getRemoteUrl", () => {
	it("returns null for a nonexistent repo directory", async () => {
		const result = await getRemoteUrl("/tmp/__bloom_no_such_repo__", "origin");
		expect(result).toBeNull();
	});

	it("returns null for a nonexistent remote name", async () => {
		// Use the actual project repo as a known git directory
		const result = await getRemoteUrl(".", "__bloom_no_such_remote__");
		expect(result).toBeNull();
	});
});

describe("inferRepoUrl", () => {
	it("falls back to the default URL when no upstream remote or bootc", async () => {
		// Using a path that is not a git repo, so getRemoteUrl returns null
		// and bootc is not available in test environment
		const result = await inferRepoUrl("/tmp/__bloom_no_such_repo__");
		expect(result).toBe("https://github.com/pibloom/pi-bloom.git");
	});
});
