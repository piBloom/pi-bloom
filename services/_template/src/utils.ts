/**
 * bloom-TEMPLATE — Utility functions
 *
 * Shared helpers for the TEMPLATE service. These are kept separate
 * from transport.ts so they can be unit-tested without mocking I/O.
 *
 * Common utilities (also used by the element service):
 *   - isChannelMessage: Type guard for channel bridge messages
 *   - parseAllowedSenders: Parse BLOOM_ALLOWED_SENDERS env var
 *   - isSenderAllowed: Check if a sender is in the allowlist
 */

// --- Channel message types ---

/** A message received from the bloom-channels bridge. */
export interface ChannelMessage {
	type: string;
	to?: string;
	text?: string;
}

/**
 * Type guard: checks if a value is a valid ChannelMessage.
 * All channel messages must have a string `type` field.
 */
export function isChannelMessage(val: unknown): val is ChannelMessage {
	return (
		typeof val === "object" &&
		val !== null &&
		"type" in val &&
		typeof (val as Record<string, unknown>).type === "string"
	);
}

// --- Sender filtering ---

/**
 * Parse the BLOOM_ALLOWED_SENDERS environment variable.
 * Format: comma-separated sender identifiers. Empty string = allow all.
 *
 * @param raw - Raw env var value
 * @returns Set of allowed sender identifiers
 */
export function parseAllowedSenders(raw: string): Set<string> {
	const entries = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return new Set(entries);
}

/**
 * Check whether a sender is allowed.
 * If the allowlist is empty, all senders are allowed.
 *
 * TODO: Override this if your service needs custom matching logic.
 * For example, Matrix matches by MXID (@user:server) format.
 *
 * @param sender - The sender identifier to check
 * @param allowedSenders - Set of allowed sender identifiers
 */
export function isSenderAllowed(sender: string, allowedSenders: Set<string>): boolean {
	if (allowedSenders.size === 0) return true;
	return allowedSenders.has(sender);
}
