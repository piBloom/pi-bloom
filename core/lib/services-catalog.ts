/** Service catalog loading, preflight checks, and package lookup. */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import jsYaml from "js-yaml";
import { commandExists, hasSubidRange } from "./services-validation.js";

// ---------------------------------------------------------------------------
// Bridge catalog
// ---------------------------------------------------------------------------

/** A single bridge entry from services/catalog.yaml. */
interface BridgeCatalogEntry {
	image: string;
	auth_method: string;
	health_port: number;
	description: string;
}

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

/** Entry for one service in the service catalog (`services/catalog.yaml`). */
export interface ServiceCatalogEntry {
	version?: string;
	category?: string;
	image?: string;
	optional?: boolean;
	depends?: string[];
	/** Host port for direct mesh access and DNS routing. */
	port?: number;
	models?: Array<{
		volume: string;
		path: string;
		url: string;
	}>;
	preflight?: {
		commands?: string[];
		rootless_subids?: boolean;
	};
}

/** Load a section from the first catalog.yaml that exists among repo dir, system share, and cwd. */
function loadCatalogSection<T>(repoDir: string, key: string): Record<string, T> {
	const candidates = [
		join(repoDir, "services", "catalog.yaml"),
		"/usr/local/share/bloom/services/catalog.yaml",
		join(process.cwd(), "services", "catalog.yaml"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const raw = readFileSync(candidate, "utf-8");
			const doc = (jsYaml.load(raw, { schema: jsYaml.JSON_SCHEMA }) as Record<string, Record<string, T>> | null) ?? {};
			if (doc[key] && typeof doc[key] === "object") return doc[key];
		} catch (err) {
			// Continue to the next candidate, but preserve context in logs by throwing to caller if all fail is not required here.
			void err;
		}
	}
	return {};
}

/** Load the bridge catalog from the first catalog.yaml that exists among repo dir, system share, and cwd. */
export function loadBridgeCatalog(repoDir: string): Record<string, BridgeCatalogEntry> {
	return loadCatalogSection<BridgeCatalogEntry>(repoDir, "bridges");
}

/** Load the service catalog from the first location that exists among repo dir, system share, and cwd. */
export function loadServiceCatalog(repoDir: string): Record<string, ServiceCatalogEntry> {
	return loadCatalogSection<ServiceCatalogEntry>(repoDir, "services");
}

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

/** Run preflight checks for a service, returning a list of human-readable errors (empty = OK). */
export async function servicePreflightErrors(
	_name: string,
	entry: ServiceCatalogEntry | undefined,
	signal?: AbortSignal,
): Promise<string[]> {
	const errors: string[] = [];
	const commands = entry?.preflight?.commands ?? ["podman", "systemctl"];
	for (const command of commands) {
		const ok = await commandExists(command, signal);
		if (!ok) errors.push(`missing command: ${command}`);
	}

	const needsSubids = entry?.preflight?.rootless_subids === true;
	if (needsSubids) {
		const user = os.userInfo().username;
		const hasSubuid = hasSubidRange("/etc/subuid", user);
		const hasSubgid = hasSubidRange("/etc/subgid", user);
		if (!hasSubuid || !hasSubgid) {
			errors.push(
				`rootless subuid/subgid mappings missing for ${user} (fix: sudo usermod --add-subuids 100000-165535 ${user} && sudo usermod --add-subgids 100000-165535 ${user})`,
			);
		}
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Package lookup
// ---------------------------------------------------------------------------

/** Find a bundled service package on disk (repo, system share, or cwd). Returns paths or null. */
export function findLocalServicePackage(
	name: string,
	repoDir: string,
): { serviceDir: string; quadletDir: string; skillPath: string } | null {
	const candidates = [
		join(repoDir, "services", name),
		`/usr/local/share/bloom/services/${name}`,
		join(process.cwd(), "services", name),
	];
	for (const serviceDir of candidates) {
		const quadletDir = join(serviceDir, "quadlet");
		const skillPath = join(serviceDir, "SKILL.md");
		if (existsSync(quadletDir) && existsSync(skillPath)) {
			return { serviceDir, quadletDir, skillPath };
		}
	}
	return null;
}
