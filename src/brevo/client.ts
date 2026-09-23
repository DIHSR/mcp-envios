import { BrevoApiError, BrevoTransportError } from "./errors.js";
import type {
  GetEmailEventsQuery,
  GetEmailEventsResponse,
  GetTransactionalEmailsQuery,
  GetTransactionalEmailsResponse,
  SendTransactionalEmailRequest,
  SendTransactionalEmailResponse,
  SendWhatsAppRequest,
  SendWhatsAppResponse,
  TransactionalEmailContent,
} from "./types.js";
import {
  calculateBackoffMs,
  DEFAULT_RETRY_OPTIONS,
  parseRetryAfterMs,
  sleep,
  type RetryOptions,
  type Sleep,
} from "../lib/retry.js";

const DEFAULT_BASE_URL = "https://api.brevo.com/v3";

type QueryValue = string | number | boolean | undefined;

export interface BrevoClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  retry?: Partial<RetryOptions>;
  sleep?: Sleep;
  random?: () => number;
  now?: () => number;
}

interface RequestOptions {
  query?: object;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

interface BrevoErrorPayload {
  code?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

export class BrevoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly retryOptions: RetryOptions;
  private readonly sleepImplementation: Sleep;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(options: BrevoClientOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new TypeError("A chave da API do Brevo é obrigatória.");
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };
    this.sleepImplementation = options.sleep ?? sleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;

    if (this.retryOptions.maxAttempts < 1) {
      throw new RangeError("maxAttempts deve ser pelo menos 1.");
    }
  }

  async sendTransactionalEmail(
    request: SendTransactionalEmailRequest,
    signal?: AbortSignal,
  ): Promise<SendTransactionalEmailResponse> {
    return await this.request<SendTransactionalEmailResponse>("POST", "/smtp/email", {
      body: request,
      signal,
    });
  }

  async sendWhatsApp(
    request: SendWhatsAppRequest,
    signal?: AbortSignal,
  ): Promise<SendWhatsAppResponse> {
    return await this.request<SendWhatsAppResponse>("POST", "/whatsapp/sendMessage", {
      body: request,
      signal,
    });
  }

  async getEmailEvents(
    query: GetEmailEventsQuery = {},
    signal?: AbortSignal,
  ): Promise<GetEmailEventsResponse> {
    return await this.request<GetEmailEventsResponse>("GET", "/smtp/statistics/events", {
      query,
      signal,
    });
  }

  async getTransactionalEmails(
    query: GetTransactionalEmailsQuery,
    signal?: AbortSignal,
  ): Promise<GetTransactionalEmailsResponse> {
    return await this.request<GetTransactionalEmailsResponse>("GET", "/smtp/emails", {
      query,
      signal,
    });
  }

  async getTransactionalEmailContent(
    uuid: string,
    signal?: AbortSignal,
  ): Promise<TransactionalEmailContent> {
    return await this.request<TransactionalEmailContent>(
      "GET",
      `/smtp/emails/${encodeURIComponent(uuid)}`,
      { signal },
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const url = this.createUrl(path, options.query);
    let lastTransportError: BrevoTransportError | undefined;

    for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          method,
          headers: {
            Accept: "application/json",
            "api-key": this.apiKey,
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error: unknown) {
        if (isAbortError(error) || options.signal?.aborted === true) {
          throw error;
        }

        lastTransportError = new BrevoTransportError(
          "Falha de comunicação com a API do Brevo.",
          error instanceof Error ? { cause: error } : undefined,
        );

        if (attempt === this.retryOptions.maxAttempts) {
          throw lastTransportError;
        }

        await this.waitBeforeRetry(attempt);
        continue;
      }

      const payload = await parseResponseBody(response);
      if (response.ok) {
        return payload as T;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const apiError = createApiError(response.status, payload, retryable);
      if (!retryable || attempt === this.retryOptions.maxAttempts) {
        throw apiError;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), this.now);
      await this.waitBeforeRetry(attempt, retryAfterMs);
    }

    throw lastTransportError ?? new BrevoTransportError("Falha de comunicação com a API do Brevo.");
  }

  private createUrl(path: string, query?: object): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (isQueryValue(value) && value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url;
  }

  private async waitBeforeRetry(attempt: number, retryAfterMs?: number): Promise<void> {
    const backoffMs = calculateBackoffMs(attempt, this.retryOptions, this.random);
    const delayMs = Math.min(
      this.retryOptions.maxDelayMs,
      retryAfterMs === undefined ? backoffMs : Math.max(backoffMs, retryAfterMs),
    );
    await this.sleepImplementation(delayMs);
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: "O Brevo retornou JSON inválido." };
    }
  }

  return { message: text };
}

function createApiError(status: number, payload: unknown, retryable: boolean): BrevoApiError {
  const errorPayload = isRecord(payload) ? (payload as BrevoErrorPayload) : undefined;
  const code = typeof errorPayload?.code === "string" ? errorPayload.code : undefined;
  const remoteMessage =
    typeof errorPayload?.message === "string" ? errorPayload.message : "Resposta de erro sem detalhes.";

  return new BrevoApiError(`A API do Brevo recusou a requisição: ${remoteMessage}`, {
    status,
    ...(code === undefined ? {} : { code }),
    response: payload,
    retryable,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQueryValue(value: unknown): value is QueryValue {
  return value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}
