/**
 * bloom-TEMPLATE — Transport layer
 *
 * This module handles the service-specific connection and message passing.
 * Replace the stub implementations with your actual transport logic.
 *
 * Typical responsibilities:
 *   - connect(): Establish connection to the external service (API, daemon, etc.)
 *   - sendMessage(): Send an outbound message via the external service
 *   - onMessage callback: Called by the transport when an inbound message arrives
 *
 * Examples from existing services:
 *   - whatsapp/transport.ts: Baileys WebSocket client for WhatsApp Web
 *   - signal/transport.ts: signal-cli JSON-RPC daemon via child process
 */

/** Options passed to connect() from the entry point. */
export interface ConnectOptions {
	/** Called when the transport receives an inbound message. */
	onMessage: (from: string, text: string) => void;
}

let _messageHandler: ((from: string, text: string) => void) | null = null;

/**
 * Initialize the service transport.
 *
 * TODO: Replace this stub with your service-specific connection logic.
 * This function should:
 *   1. Establish a connection to the external service
 *   2. Set up event listeners for incoming messages
 *   3. Call opts.onMessage() when messages arrive
 *
 * @param opts - Connection options including the inbound message callback
 */
export async function connect(opts: ConnectOptions): Promise<void> {
	_messageHandler = opts.onMessage;

	// TODO: Initialize your service client here.
	// Example:
	//   const client = await createClient({ ... });
	//   client.on("message", (msg) => {
	//     opts.onMessage(msg.from, msg.text);
	//   });

	console.log("[transport] connected (stub — replace with real implementation)");
}

/**
 * Send a message through the external service.
 *
 * TODO: Replace this stub with your actual send implementation.
 *
 * @param to - Recipient identifier (format depends on the service)
 * @param text - Message content to send
 */
export function sendMessage(to: string, text: string): void {
	// TODO: Send via your service client.
	// Example:
	//   client.sendMessage(to, { text }).catch(console.error);

	console.log(`[transport] sendMessage(${to}, ${text.slice(0, 80)}) — stub, not sent`);
}

/**
 * Disconnect and clean up transport resources.
 *
 * TODO: Replace this stub with cleanup logic for your service.
 * Called during graceful shutdown.
 */
export function disconnect(): void {
	_messageHandler = null;

	// TODO: Close client connections, kill child processes, etc.

	console.log("[transport] disconnected (stub)");
}
