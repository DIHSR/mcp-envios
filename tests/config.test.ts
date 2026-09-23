import { describe, expect, it, vi } from "vitest";

import { loadRuntimeConfig, type SecretReader } from "../src/config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  BREVO_API_KEY: "local-api-key",
  BREVO_SENDER_EMAIL: "sender@example.com",
  BREVO_SENDER_NAME: "Equipe",
  BREVO_WHATSAPP_SENDER: "5511988887777",
  MCP_TRANSPORT: "stdio",
};

describe("loadRuntimeConfig", () => {
  it("carrega configuração local com padrões seguros", async () => {
    const reader: SecretReader = { getSecret: vi.fn() };

    const config = await loadRuntimeConfig(baseEnvironment, reader);

    expect(config).toMatchObject({
      brevoApiKey: "local-api-key",
      transport: "stdio",
      clickFilterSeconds: 60,
      dryRun: false,
      logLevel: "info",
    });
    expect(reader.getSecret).not.toHaveBeenCalled();
  });

  it("carrega e prioriza valores do Secrets Manager", async () => {
    const reader: SecretReader = {
      getSecret: vi.fn().mockResolvedValue({
        BREVO_API_KEY: "production-api-key",
        MCP_AUTH_TOKEN: "production-token-with-safe-length",
      }),
    };

    const config = await loadRuntimeConfig(
      {
        ...baseEnvironment,
        MCP_TRANSPORT: "http",
        BREVO_SECRET_ARN: "arn:aws:secretsmanager:region:account:secret:mcp",
      },
      reader,
    );

    expect(reader.getSecret).toHaveBeenCalledWith(
      "arn:aws:secretsmanager:region:account:secret:mcp",
    );
    expect(config.brevoApiKey).toBe("production-api-key");
    expect(config.mcpAuthToken).toBe("production-token-with-safe-length");
  });

  it("exige token próprio no transporte HTTP", async () => {
    await expect(
      loadRuntimeConfig(
        { ...baseEnvironment, MCP_TRANSPORT: "http" },
        { getSecret: vi.fn() },
      ),
    ).rejects.toThrow();
  });
});
