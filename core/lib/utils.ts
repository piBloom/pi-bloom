/**
 * Pure utility functions with no side effects.
 */

const MAX_TRUNCATE_LENGTH = 500;

export function truncate(text: string): string {
	if (text.length <= MAX_TRUNCATE_LENGTH) return text;
	return `${text.slice(0, MAX_TRUNCATE_LENGTH)}…`;
}

export function errorResult(message: string): { error: string } {
	return { error: message };
}

export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
