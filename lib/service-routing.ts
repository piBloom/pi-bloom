/** Orchestration: creates NetBird DNS records for service subdomain routing. */

import { ensureBloomZone, ensureServiceRecord, getLocalMeshIp, loadNetBirdToken } from "./netbird.js";
import { validateServiceName } from "./services-validation.js";
import { createLogger } from "./shared.js";

const log = createLogger("service-routing");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoutingResult {
	ok: boolean;
	skipped?: boolean;
	error?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Ensure DNS routing for a service: create `{name}.bloom.mesh` A record.
 *
 * If no NetBird token is available, DNS is skipped (reported as `skipped`).
 * Services are directly reachable on their native port via the mesh IP.
 */
export async function ensureServiceRouting(serviceName: string, signal?: AbortSignal): Promise<RoutingResult> {
	const guard = validateServiceName(serviceName);
	if (guard) {
		return { ok: false, error: guard };
	}

	const token = loadNetBirdToken();
	if (!token) {
		log.info("no NetBird API token — skipping DNS record creation", { serviceName });
		return { ok: false, skipped: true };
	}

	const meshIp = await getLocalMeshIp(signal);
	if (!meshIp) {
		return { ok: false, error: "Could not determine local mesh IP from netbird status" };
	}

	const zone = await ensureBloomZone(token);
	if (!zone.ok || !zone.zoneId) {
		return { ok: false, error: zone.error ?? "Failed to ensure bloom.mesh zone" };
	}

	const record = await ensureServiceRecord(token, zone.zoneId, serviceName, meshIp);
	return { ok: record.ok, error: record.error };
}
