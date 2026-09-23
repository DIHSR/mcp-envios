import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createApplication } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import { NullLogger } from "../src/lib/logger.js";

const config: RuntimeConfig = {
  brevoApiKey: "api-key-de-teste",
  senderEmail: "sender@example.com",
  senderName: "Equipe",
  whatsappSender: "5511988887777",
  transport: "stdio",
  clickFilterSeconds: 60,
  dryRun: true,
  logLevel: "error",
};

describe("servidor MCP", () => {
  it("publica as cinco ferramentas e executa um dry-run", async () => {
    const application = createApplication(config, { logger: new NullLogger() });
    const server = application.createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "brevo_cliques_validos",
        "brevo_enviar_email",
        "brevo_enviar_whatsapp",
        "brevo_listar_eventos",
        "brevo_status_envio",
      ]);

      const result = await client.callTool({
        name: "brevo_enviar_email",
        arguments: {
          lead_id: "lead-123",
          etapa: "E1",
          template_id: 42,
          destinatario_email: "lead@example.com",
          destinatario_nome: "Lead",
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: true, status: "dry_run" });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
