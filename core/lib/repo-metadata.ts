import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { assertValidPrimaryUser, atomicWriteFile, getCanonicalRepoDir, getPrimaryUser } from "./filesystem.js";

export interface CanonicalRepoMetadata {
	path: string;
	origin: string;
	branch: string;
}

function assertCanonicalMetadataPath(metadata: CanonicalRepoMetadata, _primaryUser: string): CanonicalRepoMetadata {
	const expectedPath = getCanonicalRepoDir();
	if (metadata.path !== expectedPath) {
		throw new Error(`Invalid canonical repo metadata path: expected ${expectedPath}, got ${metadata.path}`);
	}
	return metadata;
}

export function getCanonicalRepoMetadataPath(primaryUser = getPrimaryUser()): string {
	assertValidPrimaryUser(primaryUser);
	return "/etc/nixpi/canonical-repo.json";
}

function getLegacyCanonicalRepoMetadataPath(primaryUser: string): string {
	return path.join("/home", primaryUser, ".nixpi", "canonical-repo.json");
}

export function readCanonicalRepoMetadata(primaryUser = getPrimaryUser()): CanonicalRepoMetadata | undefined {
	const validatedUser = assertValidPrimaryUser(primaryUser);
	const metadataPath = getCanonicalRepoMetadataPath(validatedUser);
	const legacyMetadataPath = getLegacyCanonicalRepoMetadataPath(validatedUser);
	const resolvedMetadataPath = existsSync(metadataPath)
		? metadataPath
		: existsSync(legacyMetadataPath)
			? legacyMetadataPath
			: undefined;
	if (!resolvedMetadataPath) return undefined;
	const parsed = JSON.parse(readFileSync(resolvedMetadataPath, "utf-8")) as Partial<CanonicalRepoMetadata>;
	if (typeof parsed.path !== "string" || typeof parsed.origin !== "string" || typeof parsed.branch !== "string") {
		throw new Error(`Invalid canonical repo metadata in ${resolvedMetadataPath}`);
	}
	const metadata: CanonicalRepoMetadata = {
		path: parsed.path,
		origin: parsed.origin,
		branch: parsed.branch,
	};
	return assertCanonicalMetadataPath(metadata, validatedUser);
}

export function writeCanonicalRepoMetadata(metadata: CanonicalRepoMetadata, primaryUser = getPrimaryUser()): string {
	const metadataPath = getCanonicalRepoMetadataPath(primaryUser);
	const validatedUser = assertValidPrimaryUser(primaryUser);
	atomicWriteFile(metadataPath, `${JSON.stringify(assertCanonicalMetadataPath(metadata, validatedUser), null, 2)}\n`);
	return metadataPath;
}
