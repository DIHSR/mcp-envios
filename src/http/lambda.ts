import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createApplication, type Application } from "../app.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../config.js";
import { isAuthorized } from "../lib/auth.js";

let configPromise: Promise<RuntimeConfig> | undefined;
let applicationPromise: Promise<Application> | undefined;

export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> {
  const config = await getConfig();
  if (!isAuthorized(getHeader(event.headers, "authorization"), config.mcpAuthToken ?? "")) {
    return unauthorizedResponse();
  }

  const application = await getApplication(config);
  const server = application.createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(toWebRequest(event));
    return await toApiGatewayResponse(response);
  } finally {
    await server.close();
  }
}

async function getConfig(): Promise<RuntimeConfig> {
  configPromise ??= loadRuntimeConfig({ ...process.env, MCP_TRANSPORT: "http" });
  return await configPromise;
}

async function getApplication(config: RuntimeConfig): Promise<Application> {
  applicationPromise ??= Promise.resolve(createApplication(config));
  return await applicationPromise;
}

function toWebRequest(event: APIGatewayProxyEventV2): Request {
  const protocol = getHeader(event.headers, "x-forwarded-proto") ?? "https";
  const host = getHeader(event.headers, "host") ?? "localhost";
  const query = event.rawQueryString.length === 0 ? "" : `?${event.rawQueryString}`;
  const url = `${protocol}://${host}${event.rawPath}${query}`;
  const method = event.requestContext.http.method;
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers)) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const body = event.body === undefined
    ? undefined
    : event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body;

  return new Request(url, {
    method,
    headers,
    ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body }),
  });
}

async function toApiGatewayResponse(response: Response): Promise<APIGatewayProxyResultV2> {
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
    isBase64Encoded: false,
  };
}

function unauthorizedResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "Unauthorized" }),
    isBase64Encoded: false,
  };
}

function getHeader(
  headers: APIGatewayProxyEventV2["headers"],
  name: string,
): string | undefined {
  const expected = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return match?.[1];
}
