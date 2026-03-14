// Extension-specific types for bloom-garden

/** Tracks which blueprints have been seeded and their content hashes. */
export interface BlueprintVersions {
	packageVersion: string;
	seeded: Record<string, string>;
	seededHashes: Record<string, string>;
	updatesAvailable: Record<string, string>;
}
