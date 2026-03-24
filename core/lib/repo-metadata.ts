import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./filesystem.js";
import { assertValidPrimaryUser, getCanonicalRepoDir, getPrimaryUser } from "./filesystem.js";

export interface CanonicalRepoMetadata {
	path: string;
	origin: string;
	branch: string;
}

function assertCanonicalMetadataPath(metadata: CanonicalRepoMetadata, primaryUser: string): CanonicalRepoMetadata {
	const expectedPath = getCanonicalRepoDir(primaryUser);
	if (metadata.path !== expectedPath) {
		throw new Error(`Invalid canonical repo metadata path: expected ${expectedPath}, got ${metadata.path}`);
	}
	return metadata;
}

export function getCanonicalRepoMetadataPath(primaryUser = getPrimaryUser()): string {
	return path.join("/home", assertValidPrimaryUser(primaryUser), ".nixpi", "canonical-repo.json");
}

export function readCanonicalRepoMetadata(
	primaryUser = getPrimaryUser(),
): CanonicalRepoMetadata | undefined {
	const metadataPath = getCanonicalRepoMetadataPath(primaryUser);
	if (!existsSync(metadataPath)) return undefined;
	const validatedUser = assertValidPrimaryUser(primaryUser);
	const parsed = JSON.parse(readFileSync(metadataPath, "utf-8")) as Partial<CanonicalRepoMetadata>;
	if (
		typeof parsed.path !== "string" ||
		typeof parsed.origin !== "string" ||
		typeof parsed.branch !== "string"
	) {
		throw new Error(`Invalid canonical repo metadata in ${metadataPath}`);
	}
	return assertCanonicalMetadataPath(parsed, validatedUser);
}

export function writeCanonicalRepoMetadata(
	metadata: CanonicalRepoMetadata,
	primaryUser = getPrimaryUser(),
): string {
	const metadataPath = getCanonicalRepoMetadataPath(primaryUser);
	const validatedUser = assertValidPrimaryUser(primaryUser);
	atomicWriteFile(metadataPath, `${JSON.stringify(assertCanonicalMetadataPath(metadata, validatedUser), null, 2)}\n`);
	return metadataPath;
}
