import "@mariozechner/pi-web-ui/app.css";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Context, Model } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import {
	AppStorage,
	ChatPanel,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";

// --------------------------------------------------------------------------
// Session ID — persisted across page reloads
// --------------------------------------------------------------------------
let sessionId = localStorage.getItem("nixpi-chat-session-id");
if (!sessionId) {
	sessionId = crypto.randomUUID();
	localStorage.setItem("nixpi-chat-session-id", sessionId);
}

// --------------------------------------------------------------------------
// Minimal AppStorage setup (no API keys needed — we use our own backend)
// --------------------------------------------------------------------------
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();

const backend = new IndexedDBStorageBackend({
	dbName: "nixpi-chat",
	version: 1,
	stores: [settings.getConfig(), providerKeys.getConfig(), sessions.getConfig(), SessionsStore.getMetadataConfig()],
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, undefined, backend);
setAppStorage(storage);

// --------------------------------------------------------------------------
// Custom streamFn — calls /chat and translates NDJSON to AssistantMessageEventStream
// --------------------------------------------------------------------------
function makeCustomStreamFn(sid: string) {
	return function customStreamFn(_model: Model<any>, context: Context, options?: { signal?: AbortSignal }) {
		const stream = createAssistantMessageEventStream();

		// Extract the last user message text from the context
		const messages = context.messages ?? [];
		let userText = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "user") {
				const content = msg.content;
				if (typeof content === "string") {
					userText = content;
				} else if (Array.isArray(content)) {
					userText = content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text ?? "")
						.join("");
				}
				break;
			}
		}

		const partial: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			api: "openai-completions",
			provider: "nixpi",
			model: "nixpi",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		stream.push({ type: "start", partial });

		void (async () => {
			let accText = "";
			try {
				const res = await fetch("/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId: sid, message: userText }),
					signal: options?.signal,
				});

				if (!res.ok || !res.body) {
					const errMsg = `Server error: ${res.status}`;
					const errPartial: AssistantMessage = {
						...partial,
						content: [{ type: "text", text: errMsg }],
						stopReason: "error",
						errorMessage: errMsg,
					};
					stream.push({ type: "error", reason: "error", error: errPartial });
					stream.end(errPartial);
					return;
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				stream.push({ type: "text_start", contentIndex: 0, partial });

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (!line.trim()) continue;
						let event: { type: string; content?: string; message?: string };
						try {
							event = JSON.parse(line) as { type: string; content?: string; message?: string };
						} catch {
							continue;
						}
						if (event.type === "text" && event.content) {
							accText += event.content;
							const updatedPartial: AssistantMessage = {
								...partial,
								content: [{ type: "text", text: accText }],
							};
							stream.push({
								type: "text_delta",
								contentIndex: 0,
								delta: event.content,
								partial: updatedPartial,
							});
						} else if (event.type === "error" && event.message) {
							const errPartial: AssistantMessage = {
								...partial,
								content: [{ type: "text", text: accText }],
								stopReason: "error",
								errorMessage: event.message,
							};
							stream.push({ type: "error", reason: "error", error: errPartial });
							stream.end(errPartial);
							return;
						}
						// "done" event from server just signals end of stream; we wait for reader.done
					}
				}

				const finalPartial: AssistantMessage = {
					...partial,
					content: [{ type: "text", text: accText }],
					stopReason: "stop",
				};
				stream.push({ type: "text_end", contentIndex: 0, content: accText, partial: finalPartial });
				stream.push({ type: "done", reason: "stop", message: finalPartial });
				stream.end(finalPartial);
			} catch (err: unknown) {
				const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"));
				const errMsg = isAbort ? "Aborted" : String(err);
				const reason = isAbort ? "aborted" : "error";
				const errPartial: AssistantMessage = {
					...partial,
					content: [{ type: "text", text: accText || errMsg }],
					stopReason: reason,
					errorMessage: errMsg,
				};
				stream.push({ type: "error", reason, error: errPartial });
				stream.end(errPartial);
			}
		})();

		return stream;
	};
}

// --------------------------------------------------------------------------
// Create Agent with custom streamFn
// --------------------------------------------------------------------------
const agent = new Agent({
	initialState: {
		systemPrompt: "",
		model: {
			id: "nixpi",
			name: "Pi",
			api: "openai-completions",
			provider: "nixpi",
			baseUrl: "",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		} as Model<any>,
		thinkingLevel: "off",
		messages: [],
		tools: [],
	},
	streamFn: makeCustomStreamFn(sessionId),
});

// --------------------------------------------------------------------------
// Mount ChatPanel
// --------------------------------------------------------------------------
async function init() {
	const chatPanel = new ChatPanel();

	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (_provider: string) => {
			// No API key needed — our backend handles auth
			return true;
		},
	});

	// Replace the <nixpi-chat> placeholder with the ChatPanel element
	const placeholder = document.querySelector("nixpi-chat");
	if (placeholder) {
		placeholder.replaceWith(chatPanel);
	} else {
		document.body.appendChild(chatPanel);
	}

	// Apply full-viewport styling
	Object.assign(chatPanel.style, {
		display: "block",
		width: "100vw",
		height: "100vh",
	});
}

init().catch((err) => console.error("Init failed:", err));
