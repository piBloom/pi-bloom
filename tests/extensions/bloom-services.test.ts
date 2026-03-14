import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractSkillMetadata } from "../../core/extensions/bloom-services/actions-install.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloom-services-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// extractSkillMetadata
// ---------------------------------------------------------------------------
describe("extractSkillMetadata", () => {
	it("returns an empty object for a missing file", () => {
		const result = extractSkillMetadata(path.join(tmpDir, "nonexistent.md"));
		expect(result).toEqual({});
	});

	it("returns an empty object for an unreadable / empty file", () => {
		const filePath = path.join(tmpDir, "empty.md");
		fs.writeFileSync(filePath, "");
		const result = extractSkillMetadata(filePath);
		expect(result).toEqual({});
	});

	it("extracts image from frontmatter", () => {
		const filePath = path.join(tmpDir, "SKILL.md");
		fs.writeFileSync(filePath, "---\nimage: ghcr.io/bloom/matrix:latest\n---\n\n# Matrix\n");
		const result = extractSkillMetadata(filePath);
		expect(result.image).toBe("ghcr.io/bloom/matrix:latest");
	});

	it("extracts version from frontmatter", () => {
		const filePath = path.join(tmpDir, "SKILL.md");
		fs.writeFileSync(filePath, "---\nversion: 1.2.3\n---\n\n# Service\n");
		const result = extractSkillMetadata(filePath);
		expect(result.version).toBe("1.2.3");
	});

	it("extracts both image and version from frontmatter", () => {
		const filePath = path.join(tmpDir, "SKILL.md");
		fs.writeFileSync(filePath, "---\nname: matrix\nimage: ghcr.io/bloom/matrix:2.0\nversion: 2.0.0\n---\n\n# Matrix\n");
		const result = extractSkillMetadata(filePath);
		expect(result.image).toBe("ghcr.io/bloom/matrix:2.0");
		expect(result.version).toBe("2.0.0");
	});

	it("returns empty values for frontmatter without image or version fields", () => {
		const filePath = path.join(tmpDir, "SKILL.md");
		fs.writeFileSync(filePath, "---\nname: my-service\ndescription: A service\n---\n\n# My service\n");
		const result = extractSkillMetadata(filePath);
		expect(result.image).toBeUndefined();
		expect(result.version).toBeUndefined();
	});
});
