/**
 * Validation guards for security-sensitive values.
 */

/** Validate that a service/unit name matches `<prefix>-[a-z0-9-]+`. Returns error message or null. */
export function guardServiceName(name: string, prefix = "nixpi"): string | null {
	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^${escapedPrefix}-[a-z0-9][a-z0-9-]*$`);
	if (!pattern.test(name)) {
		return `Security error: name must match ${prefix}-[a-z0-9-]+, got "${name}"`;
	}
	return null;
}
