/**
 * bloom-channels — Channel bridge Unix socket server at $XDG_RUNTIME_DIR/bloom/channels.sock.
 *
 * @commands /matrix (send message via Matrix)
 * @hooks session_start, agent_end, session_shutdown
 * @see {@link ../../AGENTS.md#bloom-channels} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createChannelBridge } from "./actions.js";

export { clearPairingData, extractResponseText, getPairingData, setPairingData } from "./actions.js";

export default function (pi: ExtensionAPI) {
	const bridge = createChannelBridge(pi);

	pi.on("session_start", (event, ctx) => {
		bridge.handleSessionStart(event, ctx);
	});

	pi.on("agent_end", (event, ctx) => {
		bridge.handleAgentEnd(event, ctx);
	});

	pi.on("session_shutdown", (event, ctx) => {
		bridge.handleSessionShutdown(event, ctx);
	});

	pi.registerCommand("matrix", {
		description: "Send a message via Matrix",
		handler: async (args, ctx) => {
			bridge.handleMatrixCommand(args, ctx);
		},
	});
}
