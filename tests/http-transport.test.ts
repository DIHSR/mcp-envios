import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it } from "vitest";

import { createApplication } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import { NullLogger } from "../src/lib/logger.js";

const config: RuntimeConfig = {
  brevoApiKey: "api-key-de-teste",
  senderEmail: "sender@example.com",
  senderName: "Equipe",
  whatsappSender: "5511988887777",
  mcpAuthToken: "token-http-super-seguro",
  transport: "http",
  clickFilterSeconds: 60,
  dryRun: true,
  logLevel: "error",
};

describe("Streamable HTTP stateless", () => {
  it("aceita initialize e tools/list em instâncias Lambda independentes", async () => {
    const application = createApplication(config, { logger: new NullLogger() });
    const initialize = await postStateless(application, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-test", version: "1.0.0" },
      },
    });
    expect(initialize.status).toBe(200);
    await expect(initialize.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "mcp-brevo-envio" } },
    });

    const tools = await postStateless(
      application,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      "2025-11-25",
    );
    expect(tools.status).toBe(200);
    const payload = (await tools.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(payload.result.tools).toHaveLength(5);
  });
});

async function postStateless(
  application: ReturnType<typeof createApplication>,
  payload: unknown,
  protocolVersion?: string,
): Promise<Response> {
  const server = application.createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...(protocolVersion === undefined
            ? {}
            : { "mcp-protocol-version": protocolVersion }),
        },
        body: JSON.stringify(payload),
      }),
    );
  } finally {
    await server.close();
  }
}
