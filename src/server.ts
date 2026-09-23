import "dotenv/config";

import { pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createApplication } from "./app.js";
import { loadRuntimeConfig } from "./config.js";

export async function main(): Promise<void> {
  const config = await loadRuntimeConfig();
  if (config.transport !== "stdio") {
    throw new Error(
      "O transporte HTTP deve ser iniciado pelo handler da AWS Lambda em dist/http/lambda.js.",
    );
  }

  const application = createApplication(config);
  const server = application.createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const close = async (): Promise<void> => {
    await server.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Falha ao iniciar o servidor MCP.";
    process.stderr.write(`${JSON.stringify({ level: "error", event: "startup_failed", message })}\n`);
    process.exitCode = 1;
  });
}
