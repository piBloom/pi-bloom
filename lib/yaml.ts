import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Centralized js-yaml import via createRequire (avoids ESM/CJS interop issues). */
export const yaml: { load: (str: string) => unknown; dump: (obj: unknown) => string } = require("js-yaml");
