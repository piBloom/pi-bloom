import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getGardenDir, nowIso, stringifyFrontmatter, truncate } from "./shared.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "journal_write",
		label: "Journal Write",
		description: "Write an entry to the daily journal",
		promptSnippet: "Write a journal entry for today or a specific date",
		promptGuidelines: [
			"Use journal_write for daily reflections, logs, or observations.",
			"AI entries are appended under a ## Pi section in the same file as user entries.",
		],
		parameters: Type.Object({
			content: Type.String({ description: "Journal entry content" }),
			date: Type.Optional(
				Type.String({
					description: "Date in YYYY-MM-DD format (default: today)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const date = params.date ?? new Date().toISOString().slice(0, 10);
			const [year, month] = date.split("-");
			const filepath = path.join(gardenDir, "Journal", year, month, `${date}.md`);
			fs.mkdirSync(path.dirname(filepath), { recursive: true });

			const timestamp = nowIso();
			if (fs.existsSync(filepath)) {
				const existing = fs.readFileSync(filepath, "utf-8");
				const piHeader = "\n## Pi\n";
				const piIdx = existing.indexOf(piHeader);
				if (piIdx !== -1) {
					// Append to existing Pi section
					fs.writeFileSync(filepath, `${existing}\n\n*${timestamp}*\n\n${params.content}`);
				} else {
					// Create Pi section at end of file
					fs.writeFileSync(filepath, `${existing}\n${piHeader}\n*${timestamp}*\n\n${params.content}`);
				}
			} else {
				const data: Record<string, unknown> = {
					date,
					created: nowIso(),
				};
				fs.writeFileSync(filepath, stringifyFrontmatter(data, `\n## Pi\n\n*${timestamp}*\n\n${params.content}\n`));
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `journal entry written for ${date}`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "journal_read",
		label: "Journal Read",
		description: "Read the journal for a date",
		promptSnippet: "Read the journal for today or a specific date",
		promptGuidelines: ["Use journal_read to review the daily journal."],
		parameters: Type.Object({
			date: Type.Optional(
				Type.String({
					description: "Date in YYYY-MM-DD format (default: today)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const date = params.date ?? new Date().toISOString().slice(0, 10);
			const [year, month] = date.split("-");
			const filepath = path.join(gardenDir, "Journal", year, month, `${date}.md`);

			const text = fs.existsSync(filepath) ? fs.readFileSync(filepath, "utf-8") : `No journal entry for ${date}`;
			return {
				content: [{ type: "text" as const, text: truncate(text) }],
				details: {},
			};
		},
	});
}
