/** NetBird management API client for DNS zone and record management. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { run } from "./exec.js";
import { createLogger } from "./shared.js";

const log = createLogger("netbird");

const NETBIRD_API_BASE = "https://api.netbird.io";
const BLOOM_ZONE_DOMAIN = "bloom.mesh";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetBirdGroup {
	id: string;
	name: string;
}

interface NetBirdZone {
	id: string;
	name: string;
	domain: string;
	groups?: string[];
}

interface NetBirdRecord {
	id: string;
	name: string;
	type: string;
	value: string;
}

interface DnsResult {
	ok: boolean;
	zoneId?: string;
	recordId?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Token loading
// ---------------------------------------------------------------------------

/** Load NetBird API token from `~/.config/bloom/netbird.env`. Returns null if missing. */
export function loadNetBirdToken(): string | null {
	const envPath = join(os.homedir(), ".config", "bloom", "netbird.env");
	if (!existsSync(envPath)) return null;
	try {
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.startsWith("NETBIRD_API_TOKEN=")) {
				return trimmed.slice("NETBIRD_API_TOKEN=".length).trim();
			}
		}
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Mesh IP
// ---------------------------------------------------------------------------

/** Parse the local mesh IP from `netbird status` output. */
export function parseMeshIp(statusOutput: string): string | null {
	// Look for "NetBird IP: x.x.x.x/xx" pattern
	const match = statusOutput.match(/NetBird IP:\s+(\d+\.\d+\.\d+\.\d+)/);
	return match?.[1] ?? null;
}

/** Get the local device's NetBird mesh IP by running `netbird status`. */
export async function getLocalMeshIp(signal?: AbortSignal): Promise<string | null> {
	const result = await run("netbird", ["status"], signal);
	if (result.exitCode !== 0) {
		log.warn("netbird status failed", { stderr: result.stderr });
		return null;
	}
	return parseMeshIp(result.stdout);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiGet<T>(path: string, token: string): Promise<T> {
	const res = await fetch(`${NETBIRD_API_BASE}${path}`, {
		headers: { Authorization: `Token ${token}`, Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`NetBird API GET ${path}: ${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
	const res = await fetch(`${NETBIRD_API_BASE}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Token ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`NetBird API POST ${path}: ${res.status} ${res.statusText} ${text}`);
	}
	return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** List all NetBird groups. */
async function listGroups(token: string): Promise<NetBirdGroup[]> {
	return apiGet<NetBirdGroup[]>("/api/groups", token);
}

/** Find the "All" group ID (used as default for DNS zones). */
async function findAllGroupId(token: string): Promise<string | null> {
	const groups = await listGroups(token);
	const all = groups.find((g) => g.name === "All");
	return all?.id ?? null;
}

// ---------------------------------------------------------------------------
// DNS Zones
// ---------------------------------------------------------------------------

/** Create a DNS zone. */
async function createZone(
	token: string,
	opts: { domain: string; name: string; groups: string[] },
): Promise<NetBirdZone> {
	return apiPost<NetBirdZone>("/api/dns/zones", token, {
		name: opts.name,
		domain: opts.domain,
		groups: opts.groups,
		enabled: true,
	});
}

// ---------------------------------------------------------------------------
// DNS Records
// ---------------------------------------------------------------------------

/** List records in a DNS zone. */
async function listRecords(token: string, zoneId: string): Promise<NetBirdRecord[]> {
	return apiGet<NetBirdRecord[]>(`/api/dns/zones/${zoneId}/records`, token);
}

/** Create an A record in a DNS zone. */
async function createRecord(
	token: string,
	zoneId: string,
	opts: { name: string; type: string; value: string },
): Promise<NetBirdRecord> {
	return apiPost<NetBirdRecord>(`/api/dns/zones/${zoneId}/records`, token, {
		name: opts.name,
		type: opts.type,
		value: opts.value,
		ttl: 300,
		enabled: true,
	});
}

// ---------------------------------------------------------------------------
// Zone ID caching
// ---------------------------------------------------------------------------

/** Load cached zone ID from disk. Returns null if missing or invalid. */
export function loadCachedZoneId(): string | null {
	const cachePath = join(os.homedir(), ".config", "bloom", "netbird-zone.json");
	if (!existsSync(cachePath)) return null;
	try {
		const data = JSON.parse(readFileSync(cachePath, "utf-8"));
		return typeof data.zoneId === "string" ? data.zoneId : null;
	} catch {
		return null;
	}
}

/** Save zone ID to cache file. */
export function saveCachedZoneId(zoneId: string): void {
	const cachePath = join(os.homedir(), ".config", "bloom", "netbird-zone.json");
	mkdirSync(dirname(cachePath), { recursive: true });
	writeFileSync(cachePath, JSON.stringify({ zoneId, domain: BLOOM_ZONE_DOMAIN }));
}

// ---------------------------------------------------------------------------
// Idempotent operations
// ---------------------------------------------------------------------------

/** Find or create the `bloom.mesh` DNS zone. Caches zone ID on disk. */
export async function ensureBloomZone(token: string): Promise<DnsResult> {
	// Check cache first
	const cached = loadCachedZoneId();
	if (cached) return { ok: true, zoneId: cached };

	try {
		// Search existing zones
		const zones = await apiGet<NetBirdZone[]>("/api/dns/zones", token);
		const existing = zones.find((z) => z.domain === BLOOM_ZONE_DOMAIN);
		if (existing) {
			saveCachedZoneId(existing.id);
			return { ok: true, zoneId: existing.id };
		}

		// Create new zone — need "All" group
		const groupId = await findAllGroupId(token);
		if (!groupId) return { ok: false, error: "Could not find 'All' group for DNS zone" };

		const zone = await createZone(token, {
			domain: BLOOM_ZONE_DOMAIN,
			name: "Bloom Services",
			groups: [groupId],
		});
		saveCachedZoneId(zone.id);
		log.info("created bloom.mesh DNS zone", { zoneId: zone.id });
		return { ok: true, zoneId: zone.id };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}

/** Find or create an A record for `{name}.bloom.mesh` pointing to the given IP. */
export async function ensureServiceRecord(token: string, zoneId: string, name: string, ip: string): Promise<DnsResult> {
	try {
		const records = await listRecords(token, zoneId);
		const existing = records.find((r) => r.name === name && r.type === "A");
		if (existing) {
			if (existing.value === ip) {
				return { ok: true, recordId: existing.id };
			}
			// IP changed — for now, log a warning (updating records requires PUT/DELETE)
			log.warn("DNS record exists with different IP", { name, existing: existing.value, wanted: ip });
			return { ok: true, recordId: existing.id };
		}

		const record = await createRecord(token, zoneId, { name, type: "A", value: ip });
		log.info("created DNS record", { name: `${name}.${BLOOM_ZONE_DOMAIN}`, ip });
		return { ok: true, recordId: record.id };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
}
