import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TempGarden {
	gardenDir: string;
	cleanup: () => void;
}

export function createTempGarden(): TempGarden {
	const gardenDir = mkdtempSync(path.join(os.tmpdir(), "bloom-test-garden-"));
	const origResolved = process.env._BLOOM_DIR_RESOLVED;
	const origGarden = process.env.BLOOM_DIR;

	process.env._BLOOM_DIR_RESOLVED = gardenDir;
	process.env.BLOOM_DIR = gardenDir;

	return {
		gardenDir,
		cleanup() {
			if (origResolved !== undefined) {
				process.env._BLOOM_DIR_RESOLVED = origResolved;
			} else {
				delete process.env._BLOOM_DIR_RESOLVED;
			}
			if (origGarden !== undefined) {
				process.env.BLOOM_DIR = origGarden;
			} else {
				delete process.env.BLOOM_DIR;
			}
			rmSync(gardenDir, { recursive: true, force: true });
		},
	};
}
