import { chmodSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import type { PromptRequest } from "./models.js";
import { PiCoreService } from "./service.js";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "./pi-core.json";
  const config = loadConfig(configPath);
  const service = new PiCoreService(config.pi.cwd, config.pi.sessionDir);
  const socketPath = config.server.socketPath;

  mkdirSync(dirname(socketPath), { recursive: true });
  try {
    const stat = lstatSync(socketPath);
    if (stat.isSocket()) {
      rmSync(socketPath, { force: true });
    }
  } catch {
    // socket absent; nothing to clean up
  }

  const cleanupSocket = (): void => {
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // best-effort cleanup
    }
  };

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: "missing request metadata" });
        return;
      }

      if (req.method === "GET" && req.url === "/api/v1/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && req.url === "/api/v1/prompt") {
        const body = await readJsonBody(req) as PromptRequest;
        if (!body.prompt || typeof body.prompt !== "string") {
          sendJson(res, 400, { error: "prompt must be a non-empty string" });
          return;
        }

        const reply = await service.prompt(body.prompt, body.sessionPath);
        sendJson(res, 200, reply);
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      console.error("pi-core request failed:", error);
      sendJson(res, 500, { error: "internal error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });

  chmodSync(socketPath, 0o660);
  process.on("exit", cleanupSocket);
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));

  console.log(`Pi core listening on unix://${socketPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
