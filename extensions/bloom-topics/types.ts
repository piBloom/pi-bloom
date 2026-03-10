// Extension-specific types for bloom-topics

/** Metadata for a conversation topic within a session. */
export interface TopicInfo {
	name: string;
	status: "active" | "closed";
	branchPoint: string | undefined;
}

/** Discriminated union of topic command results. */
export type TopicCommandResult =
	| { action: "notify"; message: string; level: "info" | "warning" }
	| { action: "start"; name: string; message: string }
	| { action: "close"; name: string; branchPoint: string | undefined; message: string }
	| { action: "list"; topics: TopicInfo[] }
	| { action: "switch"; name: string; branchPoint: string | undefined };
