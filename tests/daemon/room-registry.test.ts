import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RoomEntry, RoomRegistry } from "../../daemon/room-registry.js";

describe("RoomRegistry", () => {
	let dir: string;
	let registryPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "room-registry-"));
		registryPath = join(dir, "rooms.json");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates empty registry if file does not exist", () => {
		const reg = new RoomRegistry(registryPath);
		expect(reg.get("!nonexistent:bloom")).toBeUndefined();
	});

	it("loads existing registry from disk", () => {
		const data: Record<string, RoomEntry> = {
			"!abc:bloom": {
				roomAlias: "#general:bloom",
				sessionPath: "/home/pi/.pi/agent/sessions/bloom-rooms/session.jsonl",
				created: "2026-03-11T15:00:00Z",
				lastActive: "2026-03-11T16:00:00Z",
			},
		};
		writeFileSync(registryPath, JSON.stringify(data));
		const reg = new RoomRegistry(registryPath);
		expect(reg.get("!abc:bloom")).toEqual(data["!abc:bloom"]);
	});

	it("sets and persists a room entry", () => {
		const reg = new RoomRegistry(registryPath);
		const entry: RoomEntry = {
			roomAlias: "#test:bloom",
			sessionPath: "/tmp/session.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
		};
		reg.set("!xyz:bloom", entry);
		expect(reg.get("!xyz:bloom")).toEqual(entry);
		const diskData = JSON.parse(readFileSync(registryPath, "utf-8"));
		expect(diskData["!xyz:bloom"]).toEqual(entry);
	});

	it("updates lastActive on touch", () => {
		const reg = new RoomRegistry(registryPath);
		reg.set("!abc:bloom", {
			roomAlias: "#general:bloom",
			sessionPath: "/tmp/s.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
		});
		reg.touch("!abc:bloom");
		const entry = reg.get("!abc:bloom");
		expect(entry).toBeDefined();
		expect(entry?.lastActive).not.toBe("2026-03-11T15:00:00Z");
	});

	it("returns undefined for unknown room", () => {
		const reg = new RoomRegistry(registryPath);
		expect(reg.get("!unknown:bloom")).toBeUndefined();
	});
});
