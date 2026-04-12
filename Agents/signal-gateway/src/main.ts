import { loadConfig } from "./config.js";
import { PiAgentService } from "./pi/agent.js";
import { Router } from "./routing/router.js";
import { Policy } from "./routing/policy.js";
import { SignalTransport } from "./signal/transport.js";
import { Store } from "./store.js";

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "./signal-gateway.yml";
  const config = loadConfig(configPath);

  const store = new Store(config.gateway.dbPath);
  const pi = new PiAgentService(config.pi.cwd, config.gateway.piSessionDir);
  const policy = new Policy(
    new Set(config.auth.allowedNumbers),
    config.gateway.directMessagesOnly,
    config.signal.account,
  );
  const router = new Router(
    store,
    pi,
    policy,
    config.gateway.maxReplyChars,
    config.gateway.maxReplyChunks,
  );
  const transport = new SignalTransport(
    config.signal.httpUrl,
    config.signal.account,
  );

  await transport.healthCheck();
  console.log("signal-cli health check OK");
  console.log("Signal gateway started");

  await transport.startReceiving(async (msg) => {
    const result = await router.handleMessage(msg);
    for (const reply of result.replies) {
      await transport.sendText(msg.senderId, reply);
    }

    if (result.markProcessed) {
      store.markProcessedMessage(
        msg.messageId,
        msg.chatId,
        msg.senderId,
        msg.timestamp,
      );
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
