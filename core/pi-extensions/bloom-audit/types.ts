// Extension-specific types for bloom-audit

/** A single audit log entry recording a tool call or result event. */
export interface AuditEntry {
	ts: string;
	event: "tool_call" | "tool_result" | "bash_invoke" | "bash_result";
	tool: string;
	toolCallId: string;
	input?: unknown;
	isError?: boolean;
	exitCode?: number | null;
}
