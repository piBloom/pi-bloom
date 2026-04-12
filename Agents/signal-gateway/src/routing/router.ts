import type { InboundMessage } from "../models.js";
import { Store } from "../store.js";
import { PiAgentService } from "../pi/agent.js";
import { Policy } from "./policy.js";
import { chunkText, normalizeReply } from "./formatter.js";
import { KeyedSerialQueue } from "./keyed-serial-queue.js";

export class Router {
  private readonly queue = new KeyedSerialQueue();

  constructor(
    private readonly store: Store,
    private readonly pi: PiAgentService,
    private readonly policy: Policy,
    private readonly maxReplyChars: number,
    private readonly maxReplyChunks: number,
  ) {}

  async handleMessage(msg: InboundMessage): Promise<{ replies: string[]; markProcessed: boolean }> {
    return this.queue.run(msg.chatId, async () => {
      return this.handleMessageInner(msg);
    });
  }

  private async handleMessageInner(
    msg: InboundMessage,
  ): Promise<{ replies: string[]; markProcessed: boolean }> {
    if (!this.policy.isAllowedSender(msg.senderId)) {
      return { replies: [], markProcessed: false };
    }

    if (!this.policy.isAllowedMessage(msg.isGroup)) {
      return { replies: [], markProcessed: false };
    }

    if (this.store.hasProcessedMessage(msg.messageId)) {
      return { replies: [], markProcessed: false };
    }

    const text = msg.text.trim();
    if (!text) {
      return { replies: [], markProcessed: true };
    }

    const builtin = this.handleBuiltin(msg.chatId, text);
    if (builtin) {
      return {
        replies: chunkText(
          normalizeReply(builtin),
          this.maxReplyChars,
          this.maxReplyChunks,
        ),
        markProcessed: true,
      };
    }

    try {
      const prompt = this.buildPrompt(text);
      const existing = this.store.getChatSession(msg.chatId);

      const reply = existing
        ? await this.pi.promptExistingSession(existing.sessionPath, prompt)
        : await this.pi.promptNewSession(prompt);

      this.store.upsertChatSession(msg.chatId, msg.senderId, reply.sessionPath);

      return {
        replies: chunkText(
          normalizeReply(reply.text),
          this.maxReplyChars,
          this.maxReplyChunks,
        ),
        markProcessed: true,
      };
    } catch (error) {
      console.error("router.handleMessageInner failed:", error);

      return {
        replies: chunkText(
          "I hit an internal error while handling that. Try again in a moment.",
          this.maxReplyChars,
          this.maxReplyChunks,
        ),
        markProcessed: true,
      };
    }
  }

  private handleBuiltin(chatId: string, text: string): string | null {
    const lowered = text.toLowerCase();

    if (lowered === "help") {
      return [
        "You can chat with Pi here on Signal.",
        "",
        "Built-ins:",
        "- help",
        "- reset",
        "",
        "Everything else is sent to Pi.",
      ].join("\n");
    }

    if (lowered === "reset") {
      this.store.resetChatSession(chatId);
      return "Started a fresh conversation for this Signal chat.";
    }

    return null;
  }

  private buildPrompt(userText: string): string {
    return [
      "You are replying through Signal.",
      "Keep the reply concise, plain-text, and mobile-friendly.",
      "Avoid markdown-heavy formatting, large code blocks, and tables.",
      "Do not perform privileged or dangerous system actions from this channel.",
      "",
      "User message:",
      userText,
    ].join("\n");
  }
}
