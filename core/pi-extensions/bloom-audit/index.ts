/**
 * bloom-audit — Tool-call audit trail with 30-day retention.
 *
 * @tools audit_review
 * @hooks session_start, tool_call, tool_result, user_bash
 * @see {@link ../../AGENTS.md#bloom-audit} Extension reference
 */
import type { BashOperations, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLocalBashOperations } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { sanitize } from "../../lib/audit.js";
import { type RegisteredExtensionTool, defineTool, registerTools } from "../../lib/extension-tools.js";
import { appendAudit, ensureAuditDir, handleAuditReview, rotateAudit } from "./actions.js";

type AuditReviewParams = Parameters<typeof handleAuditReview>[0];

/** Wrap a BashOperations backend to emit bash_invoke/bash_result audit entries. */
function wrapBashOps(inner: BashOperations): BashOperations {
	const run = inner.exec.bind(inner);
	return {
		exec: async (command, cwd, options) => {
			const toolCallId = `bash-${Date.now()}`;
			appendAudit({
				ts: new Date().toISOString(),
				event: "bash_invoke",
				tool: "bash",
				toolCallId,
				input: { cmd: command },
			});
			const result = await run(command, cwd, options);
			appendAudit({
				ts: new Date().toISOString(),
				event: "bash_result",
				tool: "bash",
				toolCallId,
				exitCode: result.exitCode,
			});
			return result;
		},
	};
}

export default function (pi: ExtensionAPI) {
	let rotated = false;

	// Wrap pi's built-in bash backend to log every user_bash command.
	const localBash = createLocalBashOperations();
	const auditedBash = wrapBashOps(localBash);
	pi.on("user_bash", (_event) => {
		return { operations: auditedBash };
	});

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

	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "audit_review",
			label: "Audit Review",
			description: "Review recent tool calls/results from the Bloom audit trail.",
			parameters: Type.Object({
				days: Type.Optional(Type.Number({ description: "How many days to scan (1-30)", default: 1 })),
				limit: Type.Optional(Type.Number({ description: "Max entries to return (1-500)", default: 50 })),
				tool: Type.Optional(Type.String({ description: "Optional tool name filter (e.g. bash, nixos_update)" })),
				include_inputs: Type.Optional(
					Type.Boolean({ description: "Include sanitized input snippets", default: false }),
				),
			}),
			async execute(_toolCallId, params) {
				return handleAuditReview(params as AuditReviewParams);
			},
		}),
	];
	registerTools(pi, tools);
}
