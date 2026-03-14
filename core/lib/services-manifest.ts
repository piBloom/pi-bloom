/** Manifest I/O: loading, saving, and type definitions for Bloom service manifests. */
import { existsSync, readFileSync, renameSync } from "node:fs";
import jsYaml from "js-yaml";
import { atomicWriteFile } from "./fs-utils.js";
import { createLogger } from "./shared.js";

const log = createLogger("manifest");

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** A single service entry inside a Bloom manifest. */
export interface ManifestService {
	image: string;
	version?: string;
	enabled: boolean;
}

/** Declarative service manifest stored at `~/Bloom/manifest.yaml`. */
export interface Manifest {
	device?: string;
	os_image?: string;
	services: Record<string, ManifestService>;
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

function emptyManifest(): Manifest {
	return { services: {} };
}

function quarantineCorruptManifest(manifestPath: string, reason: string, error?: unknown): Manifest {
	const backupPath = `${manifestPath}.corrupt-${Date.now()}`;
	try {
		renameSync(manifestPath, backupPath);
		log.error("manifest invalid, moved aside and reset to empty", {
			manifestPath,
			backupPath,
			reason,
			...(error instanceof Error ? { error: error.message } : {}),
		});
	} catch (renameError) {
		log.error("manifest invalid, failed to move aside", {
			manifestPath,
			reason,
			...(error instanceof Error ? { error: error.message } : {}),
			...(renameError instanceof Error ? { renameError: renameError.message } : {}),
		});
	}
	return emptyManifest();
}

/** Load the manifest from disk. Returns an empty manifest if the file is missing. */
export function loadManifest(manifestPath: string): Manifest {
	if (!existsSync(manifestPath)) return emptyManifest();
	try {
		const raw = readFileSync(manifestPath, "utf-8");
		const doc = jsYaml.load(raw) as Manifest | null;
		if (!doc || typeof doc !== "object")
			return quarantineCorruptManifest(manifestPath, "manifest YAML did not decode to an object");
		if (!doc.services || typeof doc.services !== "object") {
			return quarantineCorruptManifest(manifestPath, "manifest is missing a valid services map");
		}
		return doc;
	} catch (err) {
		return quarantineCorruptManifest(manifestPath, "manifest YAML could not be parsed", err);
	}
}

/** Write the manifest to disk, creating the parent directory if needed. */
export function saveManifest(manifest: Manifest, manifestPath: string): void {
	atomicWriteFile(manifestPath, jsYaml.dump(manifest));
}
