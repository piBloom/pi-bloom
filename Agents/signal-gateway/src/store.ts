import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatSession } from "./models.js";

function utcNowIso(): string {
  return new Date().toISOString();
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.configure();
    this.init();
  }

  private configure(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_processed_messages_chat_id
      ON processed_messages(chat_id);

      CREATE TABLE IF NOT EXISTS chat_sessions (
        chat_id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        session_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_sender_id
      ON chat_sessions(sender_id);
    `);
  }

  hasProcessedMessage(messageId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM processed_messages WHERE message_id = ?`)
      .get(messageId);
    return !!row;
  }

  markProcessedMessage(
    messageId: string,
    chatId: string,
    senderId: string,
    receivedAt: string,
  ): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO processed_messages
          (message_id, chat_id, sender_id, received_at, processed_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(messageId, chatId, senderId, receivedAt, utcNowIso());
  }

  getChatSession(chatId: string): ChatSession | null {
    const row = this.db
      .prepare(`
        SELECT chat_id, sender_id, session_path, created_at, updated_at
        FROM chat_sessions
        WHERE chat_id = ?
      `)
      .get(chatId) as
      | {
          chat_id: string;
          sender_id: string;
          session_path: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      chatId: row.chat_id,
      senderId: row.sender_id,
      sessionPath: row.session_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  upsertChatSession(
    chatId: string,
    senderId: string,
    sessionPath: string,
  ): ChatSession {
    const existing = this.getChatSession(chatId);
    const now = utcNowIso();
    const createdAt = existing?.createdAt ?? now;

    this.db
      .prepare(`
        INSERT INTO chat_sessions (chat_id, sender_id, session_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          sender_id = excluded.sender_id,
          session_path = excluded.session_path,
          updated_at = excluded.updated_at
      `)
      .run(chatId, senderId, sessionPath, createdAt, now);

    return {
      chatId,
      senderId,
      sessionPath,
      createdAt,
      updatedAt: now,
    };
  }

  resetChatSession(chatId: string): void {
    this.db.prepare(`DELETE FROM chat_sessions WHERE chat_id = ?`).run(chatId);
  }
}
