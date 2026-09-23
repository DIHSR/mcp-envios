import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BrevoClient } from "./brevo/client.js";
import { BrevoEventService } from "./brevo/events.js";
import type { RuntimeConfig } from "./config.js";
import { IdempotencyCache } from "./lib/idempotency.js";
import { JsonLogger, type Logger } from "./lib/logger.js";
import type { ToolDependencies } from "./tools/dependencies.js";
import { registerBrevoTools } from "./tools/register.js";

export interface Application {
  createServer(): McpServer;
  dependencies: ToolDependencies;
}

export interface CreateApplicationOptions {
  logger?: Logger;
  idempotency?: IdempotencyCache;
  fetch?: typeof globalThis.fetch;
}

export function createApplication(
  config: RuntimeConfig,
  options: CreateApplicationOptions = {},
): Application {
  const logger = options.logger ?? new JsonLogger(config.logLevel);
  const brevo = new BrevoClient({
    apiKey: config.brevoApiKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const events = new BrevoEventService(brevo, logger);
  const dependencies: ToolDependencies = {
    brevo,
    events,
    idempotency: options.idempotency ?? new IdempotencyCache(),
    logger,
    senderEmail: config.senderEmail,
    senderName: config.senderName,
    whatsappSender: config.whatsappSender,
    clickFilterSeconds: config.clickFilterSeconds,
    dryRun: config.dryRun,
  };

  return {
    dependencies,
    createServer(): McpServer {
      const server = new McpServer(
        { name: "mcp-brevo-envio", version: "0.1.0" },
        {
          instructions:
            "Use as ferramentas de envio apenas para mensagens individuais. Consulte eventos antes de acionar gatilhos por clique e mantenha o estado da cadência no Pipedrive.",
        },
      );
      registerBrevoTools(server, dependencies);
      return server;
    },
  };
}
