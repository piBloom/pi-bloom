import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AutojoinRoomsMixin, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";

export interface CreateMatrixClientOptions {
	homeserver: string;
	accessToken: string;
	storagePath: string;
	autojoin?: boolean;
}

export function createMatrixClient(options: CreateMatrixClientOptions): MatrixClient {
	const storageDir = dirname(options.storagePath);
	if (!existsSync(storageDir)) {
		mkdirSync(storageDir, { recursive: true });
	}

	const storage = new SimpleFsStorageProvider(options.storagePath);
	const client = new MatrixClient(options.homeserver, options.accessToken, storage);
	disableDmWarmup(client);
	if (options.autojoin) {
		AutojoinRoomsMixin.setupOnClient(client);
	}
	return client;
}

function disableDmWarmup(client: MatrixClient): void {
	const dms = (client as MatrixClient & { dms?: { update?: () => Promise<void> } }).dms;
	if (!dms?.update) return;

	// Bloom never uses the SDK's DM cache in the daemon path, and fresh accounts on
	// Conduwuit return M_NOT_FOUND for m.direct during startup. Skipping the warmup
	// avoids a noisy-but-benign startup error from matrix-bot-sdk.
	dms.update = async () => undefined;
}
