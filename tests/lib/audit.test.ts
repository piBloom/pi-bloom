import { describe, expect, it } from "vitest";
import { dayStamp, SENSITIVE_KEY, sanitize, summarizeInput } from "../../core/lib/audit.js";

// ---------------------------------------------------------------------------
// dayStamp
// ---------------------------------------------------------------------------
describe("dayStamp", () => {
	it("formats a known date", () => {
		expect(dayStamp(new Date("2025-01-15T10:30:00Z"))).toBe("2025-01-15");
	});

	it("handles month boundary", () => {
		expect(dayStamp(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12-31");
	});

	it("handles year boundary", () => {
		expect(dayStamp(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
	});
});

// ---------------------------------------------------------------------------
// SENSITIVE_KEY
// ---------------------------------------------------------------------------
describe("SENSITIVE_KEY", () => {
	it.each([
		"token",
		"secret",
		"password",
		"authorization",
		"api_key",
		"api-key",
		"apiKey",
		"cookie",
	])("matches %s", (key) => {
		expect(SENSITIVE_KEY.test(key)).toBe(true);
	});

	it("does not match normal keys", () => {
		expect(SENSITIVE_KEY.test("name")).toBe(false);
		expect(SENSITIVE_KEY.test("command")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// sanitize
// ---------------------------------------------------------------------------
describe("sanitize", () => {
	it("passes through null", () => {
		expect(sanitize(null)).toBeNull();
	});

	it("passes through undefined", () => {
		expect(sanitize(undefined)).toBeUndefined();
	});

	it("passes through primitives", () => {
		expect(sanitize(42)).toBe(42);
		expect(sanitize("hello")).toBe("hello");
		expect(sanitize(true)).toBe(true);
	});

	it("redacts sensitive keys in objects", () => {
		const input = { token: "abc123", name: "safe" };
		expect(sanitize(input)).toEqual({ token: "[REDACTED]", name: "safe" });
	});

	it("redacts nested sensitive keys", () => {
		const input = { outer: { api_key: "secret", value: "ok" } };
		expect(sanitize(input)).toEqual({ outer: { api_key: "[REDACTED]", value: "ok" } });
	});

	it("sanitizes arrays", () => {
		const input = [{ password: "x" }, { data: "y" }];
		expect(sanitize(input)).toEqual([{ password: "[REDACTED]" }, { data: "y" }]);
	});

	it("truncates strings over 4000 chars", () => {
		const long = "a".repeat(5000);
		const result = sanitize(long) as string;
		expect(result.length).toBeLessThanOrEqual(4001); // 4000 + ellipsis char
		expect(result.endsWith("…")).toBe(true);
	});

	it("does not truncate strings at 4000 chars", () => {
		const exact = "b".repeat(4000);
		expect(sanitize(exact)).toBe(exact);
	});
});

// ---------------------------------------------------------------------------
// summarizeInput
// ---------------------------------------------------------------------------
describe("summarizeInput", () => {
	it("returns empty string for undefined", () => {
		expect(summarizeInput(undefined)).toBe("");
	});

	it("returns empty string for empty object", () => {
		expect(summarizeInput({})).toBe("");
	});

	it("returns JSON for normal object", () => {
		expect(summarizeInput({ key: "val" })).toBe('{"key":"val"}');
	});

	it("truncates at 160 chars with ellipsis", () => {
		const big = { data: "x".repeat(200) };
		const result = summarizeInput(big);
		expect(result.length).toBeLessThanOrEqual(161);
		expect(result.endsWith("…")).toBe(true);
	});

	it("returns <unserializable input> for circular references", () => {
		const obj: Record<string, unknown> = {};
		obj.self = obj;
		expect(summarizeInput(obj)).toBe("<unserializable input>");
	});
});
