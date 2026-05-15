#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "server.js");
const child = spawn(process.execPath, [server, ...process.argv.slice(2)], {
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 0);
});
