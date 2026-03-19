import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(process.cwd(), "core");
const ALLOWED_FILES = new Set([path.join("lib", "shared.ts")]);
const BLOCKING_UI_PATTERN = /\bctx\.ui\.(confirm|select|input|editor|custom)\s*\(/g;

function listTypeScriptFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = path.join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			files.push(...listTypeScriptFiles(fullPath));
			continue;
		}
		if (fullPath.endsWith(".ts")) {
			files.push(fullPath);
		}
	}
	return files;
}

describe("Pi UI parity guard", () => {
	it("only uses blocking Pi UI primitives inside the shared helper layer", () => {
		const violations = listTypeScriptFiles(ROOT)
			.map((file) => {
				const rel = path.relative(ROOT, file);
				if (ALLOWED_FILES.has(rel)) return null;
				const source = readFileSync(file, "utf-8");
				const matches = [...source.matchAll(BLOCKING_UI_PATTERN)];
				if (matches.length === 0) return null;
				return `${rel}: ${matches.map((match) => match[0]).join(", ")}`;
			})
			.filter((value): value is string => value !== null);

		expect(violations).toEqual([]);
	});
});
