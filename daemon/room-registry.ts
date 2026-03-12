/**
 * Room registry — maps Matrix room IDs to session file paths.
 * Persists to ~/.pi/pi-daemon/rooms.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "../lib/shared.js";

const log = createLogger("room-registry");

export interface RoomEntry {
	roomAlias: string;
	sessionPath: string;
	created: string;
	lastActive: string;
}

export class RoomRegistry {
	private rooms: Record<string, RoomEntry> = {};
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
		this.load();
	}

	private load(): void {
		if (!existsSync(this.path)) {
			log.info("no rooms.json found, starting fresh", { path: this.path });
			return;
		}
		try {
			this.rooms = JSON.parse(readFileSync(this.path, "utf-8")) as Record<string, RoomEntry>;
			log.info("loaded room registry", { count: Object.keys(this.rooms).length });
		} catch (err) {
			log.error("failed to parse rooms.json, starting fresh", { error: String(err) });
			this.rooms = {};
		}
	}

	private flush(): void {
		const dir = dirname(this.path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.path, `${JSON.stringify(this.rooms, null, "\t")}\n`);
	}

	get(roomId: string): RoomEntry | undefined {
		return this.rooms[roomId];
	}

	set(roomId: string, entry: RoomEntry): void {
		this.rooms[roomId] = entry;
		this.flush();
	}

	touch(roomId: string): void {
		const entry = this.rooms[roomId];
		if (!entry) return;
		entry.lastActive = new Date().toISOString();
		this.flush();
	}

	/** Flush to disk (for graceful shutdown). */
	flushSync(): void {
		this.flush();
	}
}
