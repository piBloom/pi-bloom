/** Sanitize a Matrix room alias or ID into a filesystem-safe name. */
export function sanitizeRoomAlias(alias: string): string {
	return alias.replace(/^[#!]/, "").replaceAll(":", "_");
}
