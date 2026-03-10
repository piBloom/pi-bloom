/**
 * Handler / business logic for bloom-topics.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TopicCommandResult, TopicInfo } from "./types.js";

/** Extract topics from session entries. */
export function getTopics(ctx: ExtensionContext | null): TopicInfo[] {
	if (!ctx) return [];
	const entries = ctx.sessionManager.getEntries();
	const topics = new Map<string, TopicInfo>();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "bloom-topic") {
			const data = (entry as { type: "custom"; customType: string; data?: unknown }).data as
				| { name?: string; status?: string; branchPoint?: string }
				| undefined;
			if (data?.name) {
				topics.set(data.name, {
					name: data.name,
					status: (data.status as "active" | "closed") ?? "active",
					branchPoint: data.branchPoint,
				});
			}
		}
	}
	return Array.from(topics.values());
}

/** Get the most recent active topic. */
export function getActiveTopic(ctx: ExtensionContext | null): TopicInfo | null {
	const topics = getTopics(ctx);
	const active = topics.filter((t) => t.status === "active");
	return active.length > 0 ? (active[active.length - 1] ?? null) : null;
}

/** Build the topic guidance system prompt fragment. */
export function buildTopicGuidance(): string {
	return [
		"",
		"## Topic Management",
		"",
		"You have topic management commands available:",
		"- `/topic new <name>` — Start a new conversation topic (e.g. `/topic new deploy-planning`)",
		"- `/topic close` — Close the current topic and summarize it",
		"- `/topic list` — Show all topics and their status",
		"- `/topic switch <name>` — Switch to an existing topic",
		"",
		"When you notice the conversation shifting to a distinctly different subject:",
		'- Suggest starting a new topic: "This seems like a new topic. You could use `/topic new <suggested-name>` to track it separately."',
		"- Do NOT auto-create topics — always suggest and let the user decide.",
		"- If the user ignores the suggestion, continue normally without repeating it.",
	].join("\n");
}

/**
 * Parse and evaluate a /topic subcommand, returning a result object
 * that the caller dispatches via Pi SDK calls.
 */
export function handleTopicCommand(args: string, ctx: ExtensionContext | null): TopicCommandResult {
	const parts = args.trim().split(/\s+/);
	const sub = parts[0] ?? "";
	const name = parts.slice(1).join(" ");

	switch (sub) {
		case "new": {
			if (!name) {
				return { action: "notify", message: "Usage: /topic new <name>", level: "warning" };
			}
			return { action: "start", name, message: `Topic started: ${name}` };
		}

		case "close": {
			const active = getActiveTopic(ctx);
			if (!active) {
				return { action: "notify", message: "No active topic to close.", level: "warning" };
			}
			return {
				action: "close",
				name: active.name,
				branchPoint: active.branchPoint,
				message: `Topic closed: ${active.name}`,
			};
		}

		case "list": {
			const topics = getTopics(ctx);
			if (topics.length === 0) {
				return { action: "notify", message: "No topics found in this session.", level: "info" };
			}
			return { action: "list", topics };
		}

		case "switch": {
			if (!name) {
				return { action: "notify", message: "Usage: /topic switch <name>", level: "warning" };
			}
			const topics = getTopics(ctx);
			const target = topics.find((t) => t.name === name);
			if (!target) {
				return { action: "notify", message: `Topic not found: ${name}`, level: "warning" };
			}
			return { action: "switch", name, branchPoint: target.branchPoint };
		}

		default: {
			return {
				action: "notify",
				message: "Usage: /topic new <name> | close | list | switch <name>",
				level: "info",
			};
		}
	}
}
