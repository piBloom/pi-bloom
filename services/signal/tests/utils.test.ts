import { describe, expect, it } from "vitest";
import { isChannelMessage, isJsonRpcResponse, isSenderAllowed, mimeToExt, parseAllowedSenders } from "../src/utils.js";

describe("mimeToExt", () => {
	it.each([
		["audio/ogg", "ogg"],
		["audio/ogg; codecs=opus", "ogg"],
		["audio/mpeg", "mp3"],
		["audio/mp4", "m4a"],
		["audio/aac", "aac"],
		["image/jpeg", "jpg"],
		["image/png", "png"],
		["image/webp", "webp"],
		["image/gif", "gif"],
		["video/mp4", "mp4"],
		["application/pdf", "pdf"],
		["application/octet-stream", "bin"],
	])("maps %s → %s", (mime, ext) => {
		expect(mimeToExt(mime)).toBe(ext);
	});

	it("falls back to subtype for unknown mime", () => {
		expect(mimeToExt("text/plain")).toBe("plain");
	});

	it("returns empty string for empty mime", () => {
		expect(mimeToExt("")).toBe("");
	});
});

describe("isChannelMessage", () => {
	it("returns true for valid object with type string", () => {
		expect(isChannelMessage({ type: "response", to: "+1234", text: "hi" })).toBe(true);
	});

	it("returns true for minimal valid object", () => {
		expect(isChannelMessage({ type: "ping" })).toBe(true);
	});

	it("returns false for null", () => {
		expect(isChannelMessage(null)).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isChannelMessage("string")).toBe(false);
		expect(isChannelMessage(42)).toBe(false);
	});

	it("returns false for missing type", () => {
		expect(isChannelMessage({ to: "+1234" })).toBe(false);
	});

	it("returns false for non-string type", () => {
		expect(isChannelMessage({ type: 123 })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseAllowedSenders
// ---------------------------------------------------------------------------
describe("parseAllowedSenders", () => {
	it("returns empty set for empty string", () => {
		expect(parseAllowedSenders("").size).toBe(0);
	});

	it("parses comma-separated entries", () => {
		const set = parseAllowedSenders("+1234567890,+0987654321");
		expect(set.size).toBe(2);
		expect(set.has("+1234567890")).toBe(true);
		expect(set.has("+0987654321")).toBe(true);
	});

	it("trims whitespace", () => {
		const set = parseAllowedSenders(" +123 , +456 ");
		expect(set.has("+123")).toBe(true);
		expect(set.has("+456")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// isSenderAllowed
// ---------------------------------------------------------------------------
describe("isSenderAllowed", () => {
	it("allows all when allowlist is empty", () => {
		expect(isSenderAllowed("+1234567890", new Set())).toBe(true);
	});

	it("allows when sender is in allowlist", () => {
		const allowed = new Set(["+1234567890"]);
		expect(isSenderAllowed("+1234567890", allowed)).toBe(true);
	});

	it("rejects when sender is not in allowlist", () => {
		const allowed = new Set(["+9999999999"]);
		expect(isSenderAllowed("+1234567890", allowed)).toBe(false);
	});
});

describe("isJsonRpcResponse", () => {
	it("returns true for success response", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: { foo: "bar" } })).toBe(true);
	});

	it("returns true for error response", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 2, error: { code: -1, message: "fail" } })).toBe(true);
	});

	it("returns false for Signal envelope", () => {
		expect(isJsonRpcResponse({ envelope: { source: "+1234" } })).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isJsonRpcResponse(null)).toBe(false);
		expect(isJsonRpcResponse("string")).toBe(false);
	});

	it("returns false for wrong jsonrpc version", () => {
		expect(isJsonRpcResponse({ jsonrpc: "1.0", id: 1 })).toBe(false);
	});
});
