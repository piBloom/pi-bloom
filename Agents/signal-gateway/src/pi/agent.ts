import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { mkdirSync } from "node:fs";
import type { PiReply } from "../models.js";

type AssistantTextBlock = {
  type: "text";
  text: string;
};

type AssistantMessageLike = {
  role: "assistant";
  content: Array<{ type: string; text?: string }>;
};

function isAssistantMessage(value: unknown): value is AssistantMessageLike {
  if (!value || typeof value !== "object") return false;
  const msg = value as { role?: unknown; content?: unknown };
  return msg.role === "assistant" && Array.isArray(msg.content);
}

function extractAssistantText(message: unknown): string {
  if (!isAssistantMessage(message)) return "";

  return message.content
    .filter((block): block is AssistantTextBlock => {
      return block.type === "text" && typeof block.text === "string";
    })
    .map((block) => block.text)
    .join("")
    .trim();
}

export class PiAgentService {
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;

  constructor(
    private readonly cwd: string,
    private readonly sessionDir: string,
  ) {
    mkdirSync(this.sessionDir, { recursive: true });
    this.authStorage = AuthStorage.create();
    this.modelRegistry = ModelRegistry.create(this.authStorage);
  }

  async promptNewSession(message: string): Promise<PiReply> {
    const sessionManager = SessionManager.create(this.cwd, this.sessionDir);

    const { session } = await createAgentSession({
      cwd: this.cwd,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    try {
      await session.prompt(message);

      const lastAssistant = [...session.messages]
        .reverse()
        .find(isAssistantMessage);

      const sessionPath = session.sessionFile;
      if (!sessionPath) {
        throw new Error("Pi session did not expose a sessionFile");
      }

      return {
        text: extractAssistantText(lastAssistant),
        sessionPath,
      };
    } finally {
      session.dispose();
    }
  }

  async promptExistingSession(sessionPath: string, message: string): Promise<PiReply> {
    const sessionManager = SessionManager.open(sessionPath, this.sessionDir);

    const { session } = await createAgentSession({
      cwd: this.cwd,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    try {
      await session.prompt(message);

      const lastAssistant = [...session.messages]
        .reverse()
        .find(isAssistantMessage);

      return {
        text: extractAssistantText(lastAssistant),
        sessionPath,
      };
    } finally {
      session.dispose();
    }
  }
}
