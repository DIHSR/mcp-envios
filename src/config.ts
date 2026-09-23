import {
  GetSecretValueCommand,
  SecretsManagerClient,
  type SecretsManagerClientConfig,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod/v4";

import type { LogLevel } from "./lib/logger.js";

export type McpTransport = "http" | "stdio";

export interface RuntimeConfig {
  brevoApiKey: string;
  senderEmail: string;
  senderName: string;
  whatsappSender: string;
  mcpAuthToken?: string;
  transport: McpTransport;
  clickFilterSeconds: number;
  dryRun: boolean;
  logLevel: LogLevel;
}

export interface SecretReader {
  getSecret(secretId: string): Promise<Record<string, string>>;
}

const configSchema = z
  .object({
    BREVO_API_KEY: z.string().trim().min(1),
    BREVO_SENDER_EMAIL: z.string().trim().email(),
    BREVO_SENDER_NAME: z.string().trim().min(1),
    BREVO_WHATSAPP_SENDER: z.string().trim().min(1),
    MCP_AUTH_TOKEN: z.string().min(16).optional(),
    MCP_TRANSPORT: z.enum(["http", "stdio"]).default("stdio"),
    CLICK_FILTER_SECONDS: z.coerce.number().finite().min(0).max(86_400).default(60),
    DRY_RUN: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOG_LEVEL: z.enum(["debug", "info", "error"]).default("info"),
  })
  .superRefine((value, context) => {
    if (value.MCP_TRANSPORT === "http" && value.MCP_AUTH_TOKEN === undefined) {
      context.addIssue({
        code: "custom",
        path: ["MCP_AUTH_TOKEN"],
        message: "MCP_AUTH_TOKEN é obrigatório no transporte HTTP.",
      });
    }
  });

export async function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  secretReader: SecretReader = new AwsSecretsManagerReader(),
): Promise<RuntimeConfig> {
  const secretId = environment.BREVO_SECRET_ARN?.trim();
  const secrets = secretId === undefined || secretId.length === 0
    ? {}
    : await secretReader.getSecret(secretId);
  const parsed = configSchema.parse({ ...environment, ...secrets });

  return {
    brevoApiKey: parsed.BREVO_API_KEY,
    senderEmail: parsed.BREVO_SENDER_EMAIL,
    senderName: parsed.BREVO_SENDER_NAME,
    whatsappSender: parsed.BREVO_WHATSAPP_SENDER,
    ...(parsed.MCP_AUTH_TOKEN === undefined ? {} : { mcpAuthToken: parsed.MCP_AUTH_TOKEN }),
    transport: parsed.MCP_TRANSPORT,
    clickFilterSeconds: parsed.CLICK_FILTER_SECONDS,
    dryRun: parsed.DRY_RUN,
    logLevel: parsed.LOG_LEVEL,
  };
}

export class AwsSecretsManagerReader implements SecretReader {
  private readonly client: SecretsManagerClient;

  constructor(configuration: SecretsManagerClientConfig = {}) {
    this.client = new SecretsManagerClient(configuration);
  }

  async getSecret(secretId: string): Promise<Record<string, string>> {
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const value = response.SecretString ?? decodeBinarySecret(response.SecretBinary);
    if (value === undefined) {
      throw new Error("O segredo configurado não contém SecretString nem SecretBinary.");
    }

    const parsed = JSON.parse(value) as unknown;
    if (!isStringRecord(parsed)) {
      throw new TypeError("O segredo deve ser um objeto JSON com valores string.");
    }
    return parsed;
  }
}

function decodeBinarySecret(value: Uint8Array | undefined): string | undefined {
  return value === undefined ? undefined : Buffer.from(value).toString("utf8");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
