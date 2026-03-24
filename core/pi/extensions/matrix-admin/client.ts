import * as fs from "node:fs";
import * as path from "node:path";
import { applyTransformations } from "./commands.js";

export interface MatrixAdminClientOptions {
  homeserver: string;
  accessToken: string;
  botUserId: string;
  configPath: string;
  fetch?: typeof globalThis.fetch;
}

interface AdminConfig {
  adminRoomId?: string;
}

export interface RunCommandResult {
  ok: boolean;
  response?: string;
  error?: string;
}

export interface RunCommandOptions {
  command: string;
  body?: string;
  awaitResponse?: boolean;
  timeoutMs?: number;
}

/** Simple async mutex to serialise concurrent runCommand calls. */
class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return () => this._release();
    }
    return new Promise<() => void>((resolve) => {
      this._queue.push(() => {
        this._locked = true;
        resolve(() => this._release());
      });
    });
  }

  private _release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._locked = false;
    }
  }
}

export class MatrixAdminClient {
  private readonly homeserver: string;
  private readonly accessToken: string;
  private readonly serverName: string;
  readonly botUserId: string;        // @pi:nixpi — caller identity
  private readonly _serverBotId: string;  // @conduit:nixpi — server bot that replies
  private readonly configPath: string;
  readonly _fetch: typeof globalThis.fetch;
  private readonly _mutex = new AsyncMutex();
  private _cachedRoomId: string | undefined;

  constructor(options: MatrixAdminClientOptions) {
    this.homeserver = options.homeserver.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.serverName = options.botUserId.split(":")[1] ?? "nixpi";
    this.botUserId = options.botUserId;
    this._serverBotId = `@conduit:${this.serverName}`;
    this.configPath = options.configPath;
    this._fetch = options.fetch ?? globalThis.fetch;
    this._loadCachedRoomId();
  }

  private _loadCachedRoomId(): void {
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const config = JSON.parse(raw) as AdminConfig;
      this._cachedRoomId = config.adminRoomId;
    } catch {
      // file doesn't exist or is malformed — will discover on first use
    }
  }

  private _saveCachedRoomId(roomId: string): void {
    const config: AdminConfig = { adminRoomId: roomId };
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf8");
    this._cachedRoomId = roomId;
  }

  async invalidateRoomCache(): Promise<void> {
    this._cachedRoomId = undefined;
    try {
      fs.unlinkSync(this.configPath);
    } catch {
      // file may not exist
    }
  }

  async getAdminRoomId(): Promise<string> {
    if (this._cachedRoomId) return this._cachedRoomId;

    const alias = `#admins:${this.serverName}`;
    const encodedAlias = encodeURIComponent(alias);
    const url = `${this.homeserver}/_matrix/client/v3/directory/room/${encodedAlias}`;

    const resp = await this._fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!resp.ok) {
      throw new Error("admin room not found");
    }

    const data = (await resp.json()) as { room_id: string };
    this._saveCachedRoomId(data.room_id);
    return data.room_id;
  }

  // getSinceToken, sendAdminCommand, pollForResponse, runCommand added in Tasks 3-5
  async runCommand(_options: RunCommandOptions): Promise<RunCommandResult> {
    throw new Error("Not yet implemented — coming in Task 5");
  }
}
