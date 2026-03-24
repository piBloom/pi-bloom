import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixAdminClient } from "../../../core/pi/extensions/matrix-admin/client.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
}

function makeClient(tmpDir: string, fetchImpl: typeof fetch) {
  return new MatrixAdminClient({
    homeserver: "http://localhost:6167",
    accessToken: "tok_test",
    botUserId: "@pi:nixpi",
    configPath: path.join(tmpDir, "matrix-admin.json"),
    fetch: fetchImpl,
  });
}

describe("admin room discovery", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("resolves room ID via directory API and caches it", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ room_id: "!abc123:nixpi" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    const roomId = await client.getAdminRoomId();

    expect(roomId).toBe("!abc123:nixpi");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:6167/_matrix/client/v3/directory/room/%23admins%3Anixpi",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok_test" }) }),
    );

    const cached = JSON.parse(fs.readFileSync(path.join(tmpDir, "matrix-admin.json"), "utf8"));
    expect(cached.adminRoomId).toBe("!abc123:nixpi");
  });

  it("stores caller botUserId from options, not the server bot ID", () => {
    const mockFetch = vi.fn();
    const client = makeClient(tmpDir, mockFetch);
    // The client should preserve the caller identity, not overwrite with server bot
    expect(client.botUserId).toBe("@pi:nixpi");
  });

  it("uses cached room ID without calling the API", async () => {
    const configPath = path.join(tmpDir, "matrix-admin.json");
    fs.writeFileSync(configPath, JSON.stringify({ adminRoomId: "!cached:nixpi" }));

    const mockFetch = vi.fn();
    const client = makeClient(tmpDir, mockFetch);
    const roomId = await client.getAdminRoomId();

    expect(roomId).toBe("!cached:nixpi");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when directory API returns non-200", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    await expect(client.getAdminRoomId()).rejects.toThrow("admin room not found");
  });

  it("re-discovers and updates cache when invalidateRoomCache is called", async () => {
    const configPath = path.join(tmpDir, "matrix-admin.json");
    fs.writeFileSync(configPath, JSON.stringify({ adminRoomId: "!old:nixpi" }));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ room_id: "!new:nixpi" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    await client.invalidateRoomCache();
    const roomId = await client.getAdminRoomId();

    expect(roomId).toBe("!new:nixpi");
    const cached = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(cached.adminRoomId).toBe("!new:nixpi");
  });
});
