import { readFileSync } from "node:fs";

export type PiCoreConfig = {
  server: {
    socketPath: string;
  };
  pi: {
    cwd: string;
    sessionDir: string;
  };
};

export function loadConfig(path: string): PiCoreConfig {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PiCoreConfig;
}
