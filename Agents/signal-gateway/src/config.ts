import { readFileSync } from "node:fs";
import YAML from "yaml";

export type AppConfig = {
  signal: {
    account: string;
    httpUrl: string;
  };
  gateway: {
    dbPath: string;
    piSessionDir: string;
    maxReplyChars: number;
    maxReplyChunks: number;
    directMessagesOnly: boolean;
  };
  pi: {
    cwd: string;
  };
  auth: {
    allowedNumbers: string[];
    adminNumbers: string[];
  };
};

export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, "utf8");
  return YAML.parse(raw) as AppConfig;
}
