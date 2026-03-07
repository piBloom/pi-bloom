import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLogger,
	errorResult,
	getBloomDir,
	getServiceRegistry,
	nowIso,
	parseFrontmatter,
	requireConfirmation,
	safePath,
	stringifyFrontmatter,
} from "../../lib/shared.js";

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------
describe("safePath", () => {
	it("resolves normal paths within root", () => {
		expect(safePath("/garden", "Inbox", "note.md")).toBe("/garden/Inbox/note.md");
	});

	it("resolves nested paths", () => {
		expect(safePath("/garden", "Projects", "myproj", "task.md")).toBe("/garden/Projects/myproj/task.md");
	});

	it("returns root when no segments given", () => {
		expect(safePath("/garden")).toBe("/garden");
	});

	it("throws on ../ traversal", () => {
		expect(() => safePath("/garden", "../../etc/passwd")).toThrow("Path traversal blocked");
	});

	it("throws on absolute path segment", () => {
		expect(() => safePath("/garden", "/etc/passwd")).toThrow("Path traversal blocked");
	});

	it("throws on traversal hidden in nested segments", () => {
		expect(() => safePath("/garden", "Projects", "..", "..", "etc", "shadow")).toThrow("Path traversal blocked");
	});

	it("allows segments that contain dots but don't escape", () => {
		expect(safePath("/garden", "my.project", "note.md")).toBe("/garden/my.project/note.md");
	});
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------
describe("parseFrontmatter", () => {
	it("returns empty attributes when no frontmatter present", () => {
		const result = parseFrontmatter("just some text");
		expect(result.attributes).toEqual({});
		expect(result.body).toBe("just some text");
		expect(result.bodyBegin).toBe(1);
		expect(result.frontmatter).toBe("");
	});

	it("returns empty attributes when closing --- is missing", () => {
		const result = parseFrontmatter("---\nkey: value\n");
		expect(result.attributes).toEqual({});
		expect(result.body).toBe("---\nkey: value\n");
	});

	it("parses simple key/value pairs", () => {
		const input = "---\ntitle: Hello\nstatus: active\n---\nbody";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ title: "Hello", status: "active" });
		expect(result.body).toBe("body");
	});

	it("parses comma-separated values as arrays for known keys", () => {
		const input = "---\ntags: a, b, c\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ tags: ["a", "b", "c"] });
	});

	it("preserves comma-containing values as strings for non-array keys", () => {
		const input = "---\ndescription: Hello, world\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ description: "Hello, world" });
	});

	it("parses YAML list items", () => {
		const input = "---\ntags:\n  - alpha\n  - beta\n---\nbody";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ tags: ["alpha", "beta"] });
	});

	it("ignores comments", () => {
		const input = "---\n# this is a comment\nkey: val\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ key: "val" });
	});

	it("preserves body content", () => {
		const input = "---\nk: v\n---\nline1\nline2";
		const result = parseFrontmatter(input);
		expect(result.body).toBe("line1\nline2");
	});

	it("calculates bodyBegin accurately", () => {
		// ---       line 1
		// k: v      line 2
		// ---       line 3
		// body      line 4
		const input = "---\nk: v\n---\nbody";
		const result = parseFrontmatter(input);
		expect(result.bodyBegin).toBe(4);
	});

	it("returns empty attributes for malformed YAML", () => {
		const input = "---\nkey: val\nno-colon-here\nother: ok\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({});
		expect(result.body).toBe(input);
	});
});

// ---------------------------------------------------------------------------
// stringifyFrontmatter
// ---------------------------------------------------------------------------
describe("stringifyFrontmatter", () => {
	it("serializes basic key/value pairs", () => {
		const result = stringifyFrontmatter({ title: "Test", status: "done" }, "body");
		expect(result).toBe("---\ntitle: Test\nstatus: done\n---\nbody");
	});

	it("serializes arrays as YAML block sequences", () => {
		const result = stringifyFrontmatter({ tags: ["a", "b"] }, "");
		expect(result).toBe("---\ntags:\n  - a\n  - b\n---\n");
	});

	it("preserves URLs with colons in values", () => {
		const result = stringifyFrontmatter({ url: "https://example.com" }, "");
		const parsed = parseFrontmatter(result);
		expect(parsed.attributes).toEqual({ url: "https://example.com" });
	});

	it("handles empty data", () => {
		const result = stringifyFrontmatter({}, "content");
		expect(result).toBe("---\n---\ncontent");
	});

	it("handles empty content", () => {
		const result = stringifyFrontmatter({ k: "v" }, "");
		expect(result).toBe("---\nk: v\n---\n");
	});
});

// ---------------------------------------------------------------------------
// parseFrontmatter <-> stringifyFrontmatter roundtrip
// ---------------------------------------------------------------------------
describe("frontmatter roundtrip", () => {
	it("roundtrip preserves data with simple values", () => {
		const data = { title: "Hello", status: "active" };
		const body = "some body";
		const str = stringifyFrontmatter(data, body);
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual(data);
		expect(parsed.body).toBe(body);
	});

	it("roundtrip preserves arrays", () => {
		const data = { tags: ["x", "y", "z"] };
		const str = stringifyFrontmatter(data, "");
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual(data);
	});
});

// ---------------------------------------------------------------------------
// errorResult
// ---------------------------------------------------------------------------
describe("errorResult", () => {
	it("returns the expected shape", () => {
		const result = errorResult("something broke");
		expect(result).toEqual({
			content: [{ type: "text", text: "something broke" }],
			details: {},
			isError: true,
		});
	});
});

// ---------------------------------------------------------------------------
// nowIso
// ---------------------------------------------------------------------------
describe("nowIso", () => {
	it("returns ISO string without milliseconds", () => {
		const result = nowIso();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});

	it("returns the correct date when mocked", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-06-15T12:30:45.123Z"));
		expect(nowIso()).toBe("2025-06-15T12:30:45Z");
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// getBloomDir
// ---------------------------------------------------------------------------
describe("getBloomDir", () => {
	const origEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...origEnv };
	});

	it("returns _BLOOM_DIR_RESOLVED when set", () => {
		process.env._BLOOM_DIR_RESOLVED = "/resolved";
		process.env.BLOOM_DIR = "/fallback";
		expect(getBloomDir()).toBe("/resolved");
	});

	it("falls back to BLOOM_DIR", () => {
		delete process.env._BLOOM_DIR_RESOLVED;
		process.env.BLOOM_DIR = "/custom";
		expect(getBloomDir()).toBe("/custom");
	});

	it("defaults to ~/Bloom", () => {
		delete process.env._BLOOM_DIR_RESOLVED;
		delete process.env.BLOOM_DIR;
		const result = getBloomDir();
		expect(result).toMatch(/\/Bloom$/);
	});
});

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------
describe("createLogger", () => {
	it("returns debug/info/warn/error methods", () => {
		const logger = createLogger("test");
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
	});

	it("logs JSON to console.log for info", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const logger = createLogger("mycomp");
		logger.info("hello");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("info");
		expect(parsed.component).toBe("mycomp");
		expect(parsed.msg).toBe("hello");
		expect(parsed.ts).toBeDefined();
		spy.mockRestore();
	});

	it("logs to console.error for error level", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.error("fail");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("error");
		spy.mockRestore();
	});

	it("logs to console.warn for warn level", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.warn("caution");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("warn");
		spy.mockRestore();
	});

	it("logs to console.log for debug level", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.debug("trace msg");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("debug");
		expect(parsed.msg).toBe("trace msg");
		spy.mockRestore();
	});

	it("includes extra fields in log output", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.info("msg", { extra: "data" });
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.extra).toBe("data");
		spy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// requireConfirmation
// ---------------------------------------------------------------------------
describe("requireConfirmation", () => {
	it("returns error when no UI and requireUi is true", async () => {
		const ctx = { hasUI: false } as never;
		const result = await requireConfirmation(ctx, "delete file");
		expect(result).toBe('Cannot perform "delete file" without interactive user confirmation.');
	});

	it("returns null when no UI and requireUi is false", async () => {
		const ctx = { hasUI: false } as never;
		const result = await requireConfirmation(ctx, "delete file", { requireUi: false });
		expect(result).toBeNull();
	});

	it("returns null when user confirms", async () => {
		const ctx = { hasUI: true, ui: { confirm: async () => true } } as never;
		const result = await requireConfirmation(ctx, "delete file");
		expect(result).toBeNull();
	});

	it("returns error when user declines", async () => {
		const ctx = { hasUI: true, ui: { confirm: async () => false } } as never;
		const result = await requireConfirmation(ctx, "delete file");
		expect(result).toBe("User declined: delete file");
	});
});

// ---------------------------------------------------------------------------
// getServiceRegistry
// ---------------------------------------------------------------------------
describe("getServiceRegistry", () => {
	const origEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...origEnv };
	});

	it("returns BLOOM_SERVICE_REGISTRY when set", () => {
		process.env.BLOOM_SERVICE_REGISTRY = "my.registry.io/org";
		expect(getServiceRegistry()).toBe("my.registry.io/org");
	});

	it("falls back to BLOOM_REGISTRY", () => {
		delete process.env.BLOOM_SERVICE_REGISTRY;
		process.env.BLOOM_REGISTRY = "other.registry.io/org";
		expect(getServiceRegistry()).toBe("other.registry.io/org");
	});

	it("defaults to ghcr.io/pibloom", () => {
		delete process.env.BLOOM_SERVICE_REGISTRY;
		delete process.env.BLOOM_REGISTRY;
		expect(getServiceRegistry()).toBe("ghcr.io/pibloom");
	});
});

