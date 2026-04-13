import { request as httpRequest } from "node:http";
import type { PiReply } from "../models.js";

type PromptResponse = {
  text: string;
  sessionPath: string;
};

type JsonResponse<T> = {
  statusCode: number;
  body: T;
};

export class PiCoreClient {
  constructor(private readonly socketPath: string) {}

  async healthCheck(): Promise<void> {
    const res = await this.requestJson<{ ok: boolean }>("GET", "/api/v1/health");
    if (res.statusCode !== 200 || !res.body.ok) {
      throw new Error(`pi-core health check failed: ${res.statusCode}`);
    }
  }

  async promptNewSession(message: string): Promise<PiReply> {
    return this.prompt(message, null);
  }

  async promptExistingSession(sessionPath: string, message: string): Promise<PiReply> {
    return this.prompt(message, sessionPath);
  }

  private async prompt(message: string, sessionPath?: string | null): Promise<PiReply> {
    const res = await this.requestJson<PromptResponse>("POST", "/api/v1/prompt", {
      prompt: message,
      sessionPath,
    });

    if (res.statusCode !== 200) {
      throw new Error(`pi-core prompt failed: ${res.statusCode}`);
    }

    return {
      text: res.body.text,
      sessionPath: res.body.sessionPath,
    };
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<JsonResponse<T>> {
    const rawBody = body === undefined ? null : JSON.stringify(body);

    return await new Promise<JsonResponse<T>>((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: rawBody
            ? {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(rawBody),
              }
            : undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on("end", () => {
            try {
              const raw = Buffer.concat(chunks).toString("utf8");
              const parsed = raw ? JSON.parse(raw) as T : {} as T;
              resolve({
                statusCode: res.statusCode ?? 0,
                body: parsed,
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      req.on("error", reject);
      if (rawBody) {
        req.write(rawBody);
      }
      req.end();
    });
  }
}
