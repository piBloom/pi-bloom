import { vi } from "vitest";

export interface RegisteredTool {
	name: string;
	[key: string]: unknown;
}

export interface RegisteredCommand {
	name: string;
	[key: string]: unknown;
}

export interface MockExtensionAPI {
	_registeredTools: RegisteredTool[];
	_registeredCommands: RegisteredCommand[];
	_eventHandlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	_sentMessages: Array<{ message: string; options?: unknown }>;
	_appendedEntries: Array<{ customType: string; data: unknown }>;
	_sessionName: string | null;
	on: ReturnType<typeof vi.fn>;
	registerTool: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	sendUserMessage: ReturnType<typeof vi.fn>;
	appendEntry: ReturnType<typeof vi.fn>;
	setSessionName: ReturnType<typeof vi.fn>;
	fireEvent: (name: string, ...args: unknown[]) => Promise<unknown>;
}

export function createMockExtensionAPI(): MockExtensionAPI {
	const tools: RegisteredTool[] = [];
	const commands: RegisteredCommand[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const messages: Array<{ message: string; options?: unknown }> = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	let _sessionName: string | null = null;

	const api: MockExtensionAPI = {
		_registeredTools: tools,
		_registeredCommands: commands,
		_eventHandlers: handlers,
		_sentMessages: messages,
		_appendedEntries: entries,
		_sessionName: null,

		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)?.push(handler);
		}),

		registerTool: vi.fn((tool: RegisteredTool) => {
			tools.push(tool);
		}),

		registerCommand: vi.fn((name: string, config: Record<string, unknown>) => {
			commands.push({ name, ...config });
		}),

		sendUserMessage: vi.fn((message: string, options?: unknown) => {
			messages.push({ message, options });
		}),

		appendEntry: vi.fn((customType: string, data: unknown) => {
			entries.push({ customType, data });
		}),

		setSessionName: vi.fn((name: string) => {
			_sessionName = name;
			api._sessionName = name;
		}),

		async fireEvent(name: string, ...args: unknown[]) {
			const eventHandlers = handlers.get(name) ?? [];
			let result: unknown;
			for (const handler of eventHandlers) {
				result = await handler(...args);
			}
			return result;
		},
	};

	return api;
}
