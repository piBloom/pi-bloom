import { describe, expect, it } from "vitest";
import { isChannelMessage, isSenderAllowed, mimeToExt, parseAllowedSenders } from "../src/utils.js";

// ---------------------------------------------------------------------------
// mimeToExt
// ---------------------------------------------------------------------------
describe("mimeToExt", () => {
	it.each([
		["audio/ogg", "ogg"],
		["audio/ogg; codecs=opus", "ogg"],
		["audio/mpeg", "mp3"],
		["audio/mp4", "m4a"],
		["audio/wav", "wav"],
		["image/jpeg", "jpg"],
		["image/png", "png"],
		["image/webp", "webp"],
		["image/gif", "gif"],
		["video/mp4", "mp4"],
		["video/3gpp", "3gp"],
		["application/pdf", "pdf"],
		["application/octet-stream", "bin"],
	])("maps %s → %s", (mime, ext) => {
		expect(mimeToExt(mime)).toBe(ext);
	});

	it("falls back to subtype for unknown mime", () => {
		expect(mimeToExt("text/plain")).toBe("plain");
	});

	it("returns empty string for empty mime (split yields empty)", () => {
		expect(mimeToExt("")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// isChannelMessage
// ---------------------------------------------------------------------------
describe("isChannelMessage", () => {
	it("returns true for valid object with type string", () => {
		expect(isChannelMessage({ type: "response", to: "!room:bloom", text: "hi" })).toBe(true);
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
		expect(isChannelMessage({ to: "!room:bloom" })).toBe(false);
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
		const set = parseAllowedSenders("@alice:bloom,@bob:bloom");
		expect(set.size).toBe(2);
		expect(set.has("@alice:bloom")).toBe(true);
		expect(set.has("@bob:bloom")).toBe(true);
	});

	it("trims whitespace", () => {
		const set = parseAllowedSenders(" @alice:bloom , @bob:bloom ");
		expect(set.has("@alice:bloom")).toBe(true);
		expect(set.has("@bob:bloom")).toBe(true);
	});

	it("ignores empty entries from trailing commas", () => {
		const set = parseAllowedSenders("@alice:bloom,,@bob:bloom,");
		expect(set.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// isSenderAllowed
// ---------------------------------------------------------------------------
describe("isSenderAllowed", () => {
	it("allows all when allowlist is empty", () => {
		expect(isSenderAllowed("@alice:bloom", new Set())).toBe(true);
	});

	it("allows when sender is in allowlist", () => {
		const allowed = new Set(["@alice:bloom"]);
		expect(isSenderAllowed("@alice:bloom", allowed)).toBe(true);
	});

	it("rejects when sender is not in allowlist", () => {
		const allowed = new Set(["@bob:bloom"]);
		expect(isSenderAllowed("@alice:bloom", allowed)).toBe(false);
	});

	it("handles multiple allowed senders", () => {
		const allowed = new Set(["@alice:bloom", "@bob:bloom"]);
		expect(isSenderAllowed("@alice:bloom", allowed)).toBe(true);
		expect(isSenderAllowed("@bob:bloom", allowed)).toBe(true);
		expect(isSenderAllowed("@charlie:bloom", allowed)).toBe(false);
	});
});
