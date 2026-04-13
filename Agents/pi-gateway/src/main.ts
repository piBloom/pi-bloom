import { loadConfig } from "./config.js";
import { PiCoreClient } from "./pi/client.js";
import { Router } from "./routing/router.js";
import { Policy } from "./routing/policy.js";
import { SignalModule } from "./modules/signal/module.js";
import type { GatewayModule } from "./modules/types.js";
import { Store } from "./store.js";

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "./pi-gateway.yml";
  const config = loadConfig(configPath);

  const modules: GatewayModule[] = [];
  if (config.modules.signal?.enabled) {
    modules.push(new SignalModule(config.modules.signal));
  }

  if (modules.length === 0) {
    throw new Error("No pi-gateway modules are enabled in the provided config");
  }

  const store = new Store(config.gateway.dbPath);
  const pi = new PiCoreClient(config.piCore.socketPath);
  const policy = new Policy();
  const router = new Router(
    store,
    pi,
    policy,
    config.gateway.maxReplyChars,
    config.gateway.maxReplyChunks,
  );

  await pi.healthCheck();
  console.log("pi-core health check OK");

  for (const module of modules) {
    await module.healthCheck();
    console.log(`${module.name} module health check OK`);
  }
  console.log(`Pi gateway started with modules: ${modules.map((module) => module.name).join(", ")}`);

  await Promise.all(
    modules.map(async (module) => {
      await module.startReceiving(async (msg) => {
        const result = await router.handleMessage(msg);
        for (const reply of result.replies) {
          await module.sendText(msg, reply);
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
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
