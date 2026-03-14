import { describe, expect, it } from "vitest";
import { sanitizeRoomAlias } from "../../core/lib/room-alias.js";

describe("sanitizeRoomAlias", () => {
	it("strips # prefix and replaces : with _", () => {
		expect(sanitizeRoomAlias("#general:localhost")).toBe("general_localhost");
	});

	it("strips ! prefix for room IDs", () => {
		expect(sanitizeRoomAlias("!abc123:localhost")).toBe("abc123_localhost");
	});

	it("handles alias with subdomain", () => {
		expect(sanitizeRoomAlias("#dev:bloom")).toBe("dev_bloom");
	});

	it("passes through already-clean strings", () => {
		expect(sanitizeRoomAlias("general_bloom")).toBe("general_bloom");
	});
});
