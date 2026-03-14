/**
 * bloom-objects — Flat-file object store with YAML frontmatter in ~/Bloom/Objects/.
 *
 * @tools memory_create, memory_read, memory_search, memory_link, memory_list
 * @see {@link ../../AGENTS.md#bloom-objects} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createObject, linkObjects, readObject } from "./actions.js";
import { listObjects, searchObjects } from "./actions-query.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "memory_create",
		label: "Memory Create",
		description: "Create a new markdown object in ~/Bloom/Objects/",
		parameters: Type.Object({
			type: Type.String({
				description: "Object type (e.g. task, note, project)",
			}),
			slug: Type.String({
				description: "URL-friendly identifier (e.g. fix-bike-tire)",
			}),
			fields: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Additional frontmatter fields",
				}),
			),
			path: Type.Optional(
				Type.String({
					description: "Optional file path relative to home dir (default: Bloom/Objects/{slug}.md)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			return createObject(params);
		},
	});

	pi.registerTool({
		name: "memory_read",
		label: "Memory Read",
		description: "Read a markdown object from ~/Bloom/Objects/",
		parameters: Type.Object({
			type: Type.String({ description: "Object type" }),
			slug: Type.String({ description: "Object slug" }),
			path: Type.Optional(Type.String({ description: "Optional direct file path relative to home dir" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			return readObject(params);
		},
	});

	pi.registerTool({
		name: "memory_search",
		label: "Memory Search",
		description: "Search markdown files for a pattern (simple string match)",
		parameters: Type.Object({
			pattern: Type.String({
				description: "Text pattern to search for",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			return searchObjects(params, signal);
		},
	});

	pi.registerTool({
		name: "memory_link",
		label: "Memory Link",
		description: "Add bidirectional links between two objects",
		parameters: Type.Object({
			ref_a: Type.String({
				description: "First object reference (type/slug)",
			}),
			ref_b: Type.String({
				description: "Second object reference (type/slug)",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			return linkObjects(params);
		},
	});

	pi.registerTool({
		name: "memory_list",
		label: "Memory List",
		description: "List objects, optionally filtered by type or frontmatter fields",
		parameters: Type.Object({
			type: Type.Optional(Type.String({ description: "Object type to filter by" })),
			directory: Type.Optional(Type.String({ description: "Directory to walk (default: ~/Bloom/Objects/)" })),
			filters: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Frontmatter field filters",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			return listObjects(params, signal);
		},
	});
}
