// Extension-specific types for bloom-persona

/** A single guardrail regex pattern with its human-readable label. */
export interface GuardrailPattern {
	pattern: string;
	label: string;
}

/** A guardrail rule binding patterns to a tool action. */
export interface GuardrailRule {
	tool: string;
	action: "block";
	patterns: GuardrailPattern[];
}

/** Top-level guardrails configuration loaded from guardrails.yaml. */
export interface GuardrailsConfig {
	rules: GuardrailRule[];
}

/** Persisted context state for cross-compaction continuity. */
export interface BloomContext {
	savedAt: string;
	updateAvailable: boolean;
}
