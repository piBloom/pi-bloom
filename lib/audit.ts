/** Regex matching keys that should be redacted in audit logs (tokens, secrets, passwords, API keys). */
export const SENSITIVE_KEY = /(token|secret|password|authorization|api[_-]?key|cookie)/i;

/** Format a Date as `YYYY-MM-DD` string. */
export function dayStamp(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Deep-clone a value, redacting keys matching SENSITIVE_KEY and truncating long strings. */
export function sanitize(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) return value.map((v) => sanitize(v));
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(val);
		}
		return out;
	}
	if (typeof value === "string" && value.length > 4000) {
		return `${value.slice(0, 4000)}…`;
	}
	return value;
}

/** Produce a compact JSON summary of tool input, truncated to 160 characters. */
export function summarizeInput(input: unknown): string {
	if (input === undefined) return "";
	try {
		const text = JSON.stringify(input);
		if (!text || text === "{}") return "";
		return text.length > 160 ? `${text.slice(0, 160)}…` : text;
	} catch {
		return "<unserializable input>";
	}
}
