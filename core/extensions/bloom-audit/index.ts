/**
 * bloom-audit — Tool-call audit trail with 30-day retention.
 *
 * @tools audit_review
 * @hooks session_start, tool_call, tool_result
 * @see {@link ../../AGENTS.md#bloom-audit} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { sanitize } from "../../lib/audit.js";
import { appendAudit, ensureAuditDir, handleAuditReview, rotateAudit } from "./actions.js";

export default function (pi: ExtensionAPI) {
	let rotated = false;

	pi.on("session_start", (_event, ctx) => {
		if (!rotated) {
			rotateAudit();
			rotated = true;
		}
		ensureAuditDir();
		if (ctx.hasUI) {
			ctx.ui.setStatus("bloom-audit", "Audit: enabled");
		}
	});

	pi.on("tool_call", (event) => {
		appendAudit({
			ts: new Date().toISOString(),
			event: "tool_call",
			tool: event.toolName,
			toolCallId: event.toolCallId,
			input: sanitize(event.input),
		});
	});

	pi.on("tool_result", (event) => {
		appendAudit({
			ts: new Date().toISOString(),
			event: "tool_result",
			tool: event.toolName,
			toolCallId: event.toolCallId,
			isError: event.isError,
		});
	});

	pi.registerTool({
		name: "audit_review",
		label: "Audit Review",
		description: "Review recent tool calls/results from the Bloom audit trail.",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ description: "How many days to scan (1-30)", default: 1 })),
			limit: Type.Optional(Type.Number({ description: "Max entries to return (1-500)", default: 50 })),
			tool: Type.Optional(Type.String({ description: "Optional tool name filter (e.g. bash, bootc)" })),
			include_inputs: Type.Optional(Type.Boolean({ description: "Include sanitized input snippets", default: false })),
		}),
		async execute(_toolCallId, params) {
			return handleAuditReview(params);
		},
	});
}
