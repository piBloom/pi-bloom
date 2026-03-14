import { describe, expect, it } from "vitest";
import { extractResponseText } from "../../core/daemon/session-events.js";

describe("extractResponseText", () => {
	it("returns string content from the last assistant message", () => {
		const messages = [{ role: "assistant", content: "summarized text" }];
		expect(extractResponseText(messages)).toBe("summarized text");
	});

	it("ignores non-assistant messages and finds the last assistant reply", () => {
		const messages = [
			{ role: "user", content: "question" },
			{ role: "assistant", content: "hello" },
		];
		expect(extractResponseText(messages)).toBe("hello");
	});

	it("prefers the last assistant message when multiple are present", () => {
		const messages = [
			{ role: "assistant", content: "draft" },
			{ role: "toolResult", content: "tool output" },
			{ role: "assistant", content: "actual response" },
		];
		expect(extractResponseText(messages)).toBe("actual response");
	});

	it("joins text blocks from structured assistant content", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "part1" },
					{ type: "image", mimeType: "image/png", data: "..." },
					{ type: "text", text: "part2" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("part1\n\npart2");
	});

	it("returns empty string when there is no assistant message", () => {
		expect(extractResponseText([{ role: "user", content: "hello" }])).toBe("");
	});

	it("returns empty string when assistant content has no text", () => {
		const messages = [{ role: "assistant", content: [{ type: "image", mimeType: "image/png", data: "..." }] }];
		expect(extractResponseText(messages)).toBe("");
	});

	it("returns empty string for empty input", () => {
		expect(extractResponseText([])).toBe("");
	});

	it("handles multiple assistant messages with structured and string content", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: "second" },
		];
		expect(extractResponseText(messages)).toBe("second");
	});
});
