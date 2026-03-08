import matter from "@11ty/gray-matter";
import jsYaml from "js-yaml";

export const yaml: { load: (str: string) => unknown; dump: (obj: unknown) => string } = jsYaml;

/** Result of parsing YAML frontmatter from a markdown string. */
export interface ParsedFrontmatter<T> {
	attributes: T;
	body: string;
	bodyBegin: number;
	frontmatter: string;
}

/** Frontmatter keys that are parsed as comma-separated arrays. */
const FRONTMATTER_ARRAY_KEYS = new Set(["tags", "links", "aliases"]);

/** Serialize a data object and markdown body into a frontmatter-delimited string. */
export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
	const keys = Object.keys(data);
	if (keys.length === 0) return `---\n---\n${content}`;
	const yamlStr = jsYaml.dump(data, { schema: jsYaml.JSON_SCHEMA }).trimEnd();
	return `---\n${yamlStr}\n---\n${content}`;
}

/** Parse YAML frontmatter from a markdown string. Returns attributes, body, and metadata. Supports comma-separated arrays and YAML-style list arrays. */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	str: string,
): ParsedFrontmatter<T> {
	const empty: ParsedFrontmatter<T> = { attributes: {} as T, body: str, bodyBegin: 1, frontmatter: "" };
	if (!str.startsWith("---\n")) return empty;
	if (str.indexOf("\n---\n", 4) === -1 && !str.match(/\n---$/)) return empty;

	let result: { data: Record<string, unknown>; content: string; matter: string };
	try {
		result = matter(str, { schema: jsYaml.JSON_SCHEMA } as Record<string, unknown>);
	} catch {
		return empty;
	}
	const attributes = result.data as Record<string, unknown>;

	// Compat layer: split comma-separated strings into arrays for known keys
	for (const key of FRONTMATTER_ARRAY_KEYS) {
		const val = attributes[key];
		if (typeof val === "string" && val.includes(",")) {
			attributes[key] = val
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		}
	}

	const frontmatter = result.matter.trimStart();
	const bodyBegin = frontmatter.split("\n").length + 3;
	return {
		attributes: attributes as T,
		body: result.content,
		bodyBegin,
		frontmatter,
	};
}
