/**
 * Blueprint versioning and seeding logic for bloom-garden.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPackageVersion } from "./actions.js";
import type { BlueprintVersions } from "./types.js";

const PERSONA_FILES = ["SOUL.md", "BODY.md", "FACULTY.md", "SKILL.md"];

// --- Blueprint versioning ---

export function readBlueprintVersions(bloomDir: string): BlueprintVersions {
	const fp = path.join(bloomDir, "blueprint-versions.json");
	try {
		const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as Partial<BlueprintVersions>;
		return {
			packageVersion: parsed.packageVersion ?? "0.0.0",
			seeded: parsed.seeded ?? {},
			seededHashes: parsed.seededHashes ?? {},
			updatesAvailable: parsed.updatesAvailable ?? {},
		};
	} catch {
		return { packageVersion: "0.0.0", seeded: {}, seededHashes: {}, updatesAvailable: {} };
	}
}

export function writeBlueprintVersions(bloomDir: string, versions: BlueprintVersions): void {
	fs.writeFileSync(path.join(bloomDir, "blueprint-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
}

// --- Hashing ---

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

// --- Blueprint seeding ---

function blueprintDestPath(bloomDir: string, key: string): string {
	if (key.startsWith("persona/")) {
		return path.join(bloomDir, "Persona", key.replace(/^persona\//, ""));
	}
	if (key.startsWith("skills/")) {
		return path.join(bloomDir, "Skills", key.replace(/^skills\//, ""));
	}
	if (key === "guardrails.yaml") {
		return path.join(bloomDir, "guardrails.yaml");
	}
	return path.join(bloomDir, key);
}

function seedFile(src: string, dest: string, key: string, version: string, versions: BlueprintVersions): void {
	if (!fs.existsSync(src)) return;

	const srcContent = fs.readFileSync(src, "utf-8");
	const srcHash = hashContent(srcContent);

	if (!fs.existsSync(dest)) {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, srcContent);
		versions.seeded[key] = version;
		versions.seededHashes[key] = srcHash;
		delete versions.updatesAvailable[key];
		return;
	}

	const destContent = fs.readFileSync(dest, "utf-8");
	const destHash = hashContent(destContent);
	const previousSeedHash = versions.seededHashes[key];

	if (destHash === srcHash) {
		versions.seeded[key] = version;
		versions.seededHashes[key] = srcHash;
		delete versions.updatesAvailable[key];
		return;
	}

	// If the destination file was never modified by the user since our last seed,
	// apply the updated blueprint automatically.
	if (previousSeedHash && destHash === previousSeedHash) {
		fs.writeFileSync(dest, srcContent);
		versions.seeded[key] = version;
		versions.seededHashes[key] = srcHash;
		delete versions.updatesAvailable[key];
		return;
	}

	versions.updatesAvailable[key] = version;
}

export function seedBlueprints(bloomDir: string, packageDir: string): void {
	const version = getPackageVersion(packageDir);
	const versions = readBlueprintVersions(bloomDir);
	const personaDir = fs.existsSync(path.join(packageDir, "core", "pi-persona"))
		? path.join(packageDir, "core", "pi-persona")
		: path.join(packageDir, "persona");
	const _skillsDir = fs.existsSync(path.join(packageDir, "core", "pi-skills"))
		? path.join(packageDir, "core", "pi-skills")
		: path.join(packageDir, "skills");

	for (const file of PERSONA_FILES) {
		const key = `persona/${file}`;
		const src = path.join(personaDir, file);
		const dest = path.join(bloomDir, "Persona", file);
		seedFile(src, dest, key, version, versions);
	}

	// Skills are intentionally NOT seeded to ~/Bloom/Skills/.
	// The package path already exposes them to the agent via the `packages`
	// setting in settings.json.  Seeding them here creates duplicate sources
	// that cause "collision" warnings at startup (package = user priority,
	// ~/Bloom/Skills/ = temp priority, same name → conflict).
	// ~/Bloom/Skills/ is reserved for user-created custom skills only.

	// Seed guardrails policy
	seedFile(
		path.join(packageDir, "guardrails.yaml"),
		path.join(bloomDir, "guardrails.yaml"),
		"guardrails.yaml",
		version,
		versions,
	);

	versions.packageVersion = version;
	writeBlueprintVersions(bloomDir, versions);
}

export function handleUpdateBlueprints(bloomDir: string, packageDir: string): number {
	const versions = readBlueprintVersions(bloomDir);
	const updates = Object.entries(versions.updatesAvailable);
	if (updates.length === 0) return 0;

	for (const [key, version] of updates) {
		const src = path.join(packageDir, key);
		const dest = blueprintDestPath(bloomDir, key);
		if (!fs.existsSync(src)) continue;
		const srcContent = fs.readFileSync(src, "utf-8");
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, srcContent);
		versions.seeded[key] = version;
		versions.seededHashes[key] = hashContent(srcContent);
		delete versions.updatesAvailable[key];
	}
	writeBlueprintVersions(bloomDir, versions);
	return updates.length;
}
