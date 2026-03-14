import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBloomDir, safePath } from "../../core/lib/filesystem.js";

const ROOT = path.join(os.tmpdir(), "bloom-fs-test-root");

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------
describe("safePath", () => {
	it("resolves a valid subpath under the root", () => {
		const result = safePath(ROOT, "Skills", "my-skill");
		expect(result).toBe(path.join(ROOT, "Skills", "my-skill"));
	});

	it("allows a path equal to the root (no segments)", () => {
		const result = safePath(ROOT);
		expect(result).toBe(path.resolve(ROOT));
	});

	it("throws on path traversal with ../", () => {
		expect(() => safePath(ROOT, "../escape")).toThrow("Path traversal blocked");
	});

	it("throws on deep path traversal that escapes root", () => {
		expect(() => safePath(ROOT, "Skills", "../../etc/passwd")).toThrow("Path traversal blocked");
	});

	it("handles nested valid subpath correctly", () => {
		const result = safePath(ROOT, "Objects", "notes", "my-note.md");
		expect(result).toBe(path.join(ROOT, "Objects", "notes", "my-note.md"));
	});
});

// ---------------------------------------------------------------------------
// getBloomDir
// ---------------------------------------------------------------------------
describe("getBloomDir", () => {
	let origBloomDir: string | undefined;

	beforeEach(() => {
		origBloomDir = process.env.BLOOM_DIR;
	});

	afterEach(() => {
		if (origBloomDir !== undefined) {
			process.env.BLOOM_DIR = origBloomDir;
		} else {
			delete process.env.BLOOM_DIR;
		}
	});

	it("returns BLOOM_DIR when env var is set", () => {
		process.env.BLOOM_DIR = "/custom/bloom";
		expect(getBloomDir()).toBe("/custom/bloom");
	});

	it("falls back to ~/Bloom when env var is not set", () => {
		delete process.env.BLOOM_DIR;
		const expected = path.join(os.homedir(), "Bloom");
		expect(getBloomDir()).toBe(expected);
	});

	it("reflects changes to BLOOM_DIR dynamically", () => {
		process.env.BLOOM_DIR = "/first/path";
		expect(getBloomDir()).toBe("/first/path");

		process.env.BLOOM_DIR = "/second/path";
		expect(getBloomDir()).toBe("/second/path");
	});
});
