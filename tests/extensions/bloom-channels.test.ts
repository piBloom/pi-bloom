import { describe, expect, it } from "vitest";
import {
	clearPairingData,
	extractResponseText,
	getPairingData,
	setPairingData,
} from "../../extensions/bloom-channels.js";

// ---------------------------------------------------------------------------
// extractResponseText (inlined from lib/channel-utils.ts)
// ---------------------------------------------------------------------------
describe("extractResponseText", () => {
	it("extracts string content (post-compaction)", () => {
		const messages = [{ role: "assistant", content: "summarized text" }];
		expect(extractResponseText(messages)).toBe("summarized text");
	});

	it("extracts text blocks from array content", () => {
		const messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
			},
		];
		expect(extractResponseText(messages)).toBe("hello");
	});

	it("skips tool_use blocks", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "1", name: "foo" },
					{ type: "text", text: "actual response" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("actual response");
	});

	it("concatenates multiple text parts", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "part1" },
					{ type: "text", text: "part2" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("part1\n\npart2");
	});

	it("returns empty string for no assistant messages", () => {
		const messages = [{ role: "user", content: "hello" }];
		expect(extractResponseText(messages)).toBe("");
	});

	it("returns empty string for tool-only turns", () => {
		const messages = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "1", name: "foo" }],
			},
		];
		expect(extractResponseText(messages)).toBe("");
	});

	it("returns last assistant message text", () => {
		const messages = [
			{ role: "assistant", content: "first" },
			{ role: "user", content: "question" },
			{ role: "assistant", content: "second" },
		];
		expect(extractResponseText(messages)).toBe("second");
	});

	it("returns empty string for empty messages array", () => {
		expect(extractResponseText([])).toBe("");
	});
});

// ---------------------------------------------------------------------------
// pairing state
// ---------------------------------------------------------------------------
describe("pairing state", () => {
	it("returns null when no pairing data exists", () => {
		expect(getPairingData("whatsapp")).toBeNull();
	});

	it("stores and retrieves pairing data", () => {
		setPairingData("whatsapp", "2@ABC123");
		expect(getPairingData("whatsapp")).toBe("2@ABC123");
		clearPairingData("whatsapp");
	});

	it("overwrites previous pairing data", () => {
		setPairingData("signal", "sgnl://first");
		setPairingData("signal", "sgnl://second");
		expect(getPairingData("signal")).toBe("sgnl://second");
		clearPairingData("signal");
	});

	it("clearPairingData removes data", () => {
		setPairingData("whatsapp", "data");
		clearPairingData("whatsapp");
		expect(getPairingData("whatsapp")).toBeNull();
	});
});
