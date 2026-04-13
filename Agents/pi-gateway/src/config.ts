import { readFileSync } from "node:fs";
import YAML from "yaml";

export type SignalModuleConfig = {
  enabled: boolean;
  account: string;
  httpUrl: string;
  allowedNumbers: string[];
  adminNumbers: string[];
  directMessagesOnly: boolean;
};

export type AppConfig = {
  gateway: {
    dbPath: string;
    maxReplyChars: number;
    maxReplyChunks: number;
  };
  piCore: {
    socketPath: string;
  };
  modules: {
    signal?: SignalModuleConfig;
  };
};

export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, "utf8");
  return YAML.parse(raw) as AppConfig;
}
