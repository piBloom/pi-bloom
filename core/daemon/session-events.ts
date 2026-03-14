export interface SessionEvent {
	type: string;
	[key: string]: unknown;
}

export function extractResponseText(messages: readonly Record<string, unknown>[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;

		const content = msg.content;
		if (typeof content === "string") return content;

		if (Array.isArray(content)) {
			const textParts = (content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text as string);
			if (textParts.length > 0) return textParts.join("\n\n");
		}
	}
	return "";
}
