/** Service catalog loading and preflight checks. */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { yaml } from "./frontmatter.js";
import type { ServiceCatalogEntry } from "./services-manifest.js";
import { commandExists, hasSubidRange } from "./services-validation.js";

// ---------------------------------------------------------------------------
// Bridge catalog
// ---------------------------------------------------------------------------

/** A single bridge entry from services/catalog.yaml. */
export interface BridgeCatalogEntry {
	image: string;
	auth_method: string;
	health_port: number;
	description: string;
}

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

/** Load the bridge catalog from the first catalog.yaml that exists among repo dir, system share, and cwd. */
export function loadBridgeCatalog(repoDir: string): Record<string, BridgeCatalogEntry> {
	const candidates = [
		join(repoDir, "services", "catalog.yaml"),
		"/usr/local/share/bloom/services/catalog.yaml",
		join(process.cwd(), "services", "catalog.yaml"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const raw = readFileSync(candidate, "utf-8");
			const doc = (yaml.load(raw) as { bridges?: Record<string, BridgeCatalogEntry> } | null) ?? {};
			if (doc.bridges && typeof doc.bridges === "object") return doc.bridges;
		} catch {
			// ignore and continue
		}
	}
	return {};
}

/** Load the service catalog from the first location that exists among repo dir, system share, and cwd. */
export function loadServiceCatalog(repoDir: string): Record<string, ServiceCatalogEntry> {
	const candidates = [
		join(repoDir, "services", "catalog.yaml"),
		"/usr/local/share/bloom/services/catalog.yaml",
		join(process.cwd(), "services", "catalog.yaml"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const raw = readFileSync(candidate, "utf-8");
			const doc = (yaml.load(raw) as { services?: Record<string, ServiceCatalogEntry> } | null) ?? {};
			if (doc.services && typeof doc.services === "object") return doc.services;
		} catch {
			// ignore and continue
		}
	}
	return {};
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
