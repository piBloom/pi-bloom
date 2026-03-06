import { safePath } from "./shared.js";

/** Parse a `type/slug` reference string into its components. Throws if format is invalid. */
export function parseRef(ref: string): { type: string; slug: string } {
	const slash = ref.indexOf("/");
	if (slash === -1) throw new Error(`invalid reference format: '${ref}' (expected type/slug)`);
	return { type: ref.slice(0, slash), slug: ref.slice(slash + 1) };
}

/** Resolve the filesystem path for a new object based on PARA fields (project, area, or Inbox fallback). */
export function resolveCreatePath(gardenDir: string, slug: string, fields: Record<string, string>): string {
	if (fields.project) return safePath(gardenDir, "Projects", fields.project, `${slug}.md`);
	if (fields.area) return safePath(gardenDir, "Areas", fields.area, `${slug}.md`);
	return safePath(gardenDir, "Inbox", `${slug}.md`);
}
