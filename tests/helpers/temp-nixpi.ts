import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TempNixPi {
	nixPiDir: string;
	cleanup: () => void;
}

export function createTempNixPi(): TempNixPi {
	const nixPiDir = mkdtempSync(path.join(os.tmpdir(), "nixpi-test-root-"));
	const origResolved = process.env._NIXPI_DIR_RESOLVED;
	const origNixPiDir = process.env.NIXPI_DIR;

	process.env._NIXPI_DIR_RESOLVED = nixPiDir;
	process.env.NIXPI_DIR = nixPiDir;

	return {
		nixPiDir,
		cleanup() {
			if (origResolved !== undefined) {
				process.env._NIXPI_DIR_RESOLVED = origResolved;
			} else {
				delete process.env._NIXPI_DIR_RESOLVED;
			}
			if (origNixPiDir !== undefined) {
				process.env.NIXPI_DIR = origNixPiDir;
			} else {
				delete process.env.NIXPI_DIR;
			}
			rmSync(nixPiDir, { recursive: true, force: true });
		},
	};
}
