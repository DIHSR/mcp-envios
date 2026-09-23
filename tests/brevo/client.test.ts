import { describe, expect, it, vi } from "vitest";

import { BrevoClient } from "../../src/brevo/client.js";
import { BrevoApiError, BrevoTransportError } from "../../src/brevo/errors.js";

const API_KEY = "xkeysib-segredo-de-teste";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("BrevoClient", () => {
  it("envia e-mail transacional com autenticação e payload corretos", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ messageId: "<message@example.com>" }, 201),
    );
    const client = new BrevoClient({ apiKey: API_KEY, fetch: fetchMock });

    const result = await client.sendTransactionalEmail({
      templateId: 42,
      to: [{ email: "lead@example.com", name: "Lead" }],
      params: { nome: "Lead" },
      tags: ["mcp_corr_exemplo"],
      headers: { "X-Mailin-custom": '{"lead_id":"123","etapa":"E1"}' },
    });

    expect(result.messageId).toBe("<message@example.com>");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("api-key")).toBe(API_KEY);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      templateId: 42,
      to: [{ email: "lead@example.com", name: "Lead" }],
    });
  });

  it("envia WhatsApp usando os nomes de campos oficiais", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ messageId: "23befbae-1505-47a8-bd27-e30ef739f32c" }, 201),
    );
    const client = new BrevoClient({ apiKey: API_KEY, fetch: fetchMock });

    await client.sendWhatsApp({
      templateId: 123,
      senderNumber: "5511988887777",
      contactNumbers: ["5586999999999"],
      params: { nome: "Maria" },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      templateId: 123,
      senderNumber: "5511988887777",
      contactNumbers: ["5586999999999"],
      params: { nome: "Maria" },
    });
  });

  it("serializa filtros de eventos na query string", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ events: [] }));
    const client = new BrevoClient({ apiKey: API_KEY, fetch: fetchMock });

    await client.getEmailEvents({
      startDate: "2026-09-01",
      endDate: "2026-09-23",
      event: "clicks",
      limit: 500,
      offset: 100,
      messageId: "<message@example.com>",
    });

    const [input] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/v3/smtp/statistics/events");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2026-09-23",
      event: "clicks",
      limit: "500",
      offset: "100",
      messageId: "<message@example.com>",
    });
  });

  it("repete HTTP 429, respeitando Retry-After", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: "rate_limit", message: "Aguarde" }, 429, {
        "retry-after": "2",
      }))
      .mockResolvedValueOnce(jsonResponse({ events: [] }));
    const sleepMock = vi.fn(async (_milliseconds: number) => undefined);
    const client = new BrevoClient({
      apiKey: API_KEY,
      fetch: fetchMock,
      sleep: sleepMock,
      random: () => 0,
      retry: { maxDelayMs: 5_000 },
    });

    await client.getEmailEvents();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(2_000);
  });

  it("repete falhas 5xx no máximo três vezes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ code: "internal_error", message: "Falha temporária" }, 503),
      );
    const sleepMock = vi.fn(async (_milliseconds: number) => undefined);
    const client = new BrevoClient({
      apiKey: API_KEY,
      fetch: fetchMock,
      sleep: sleepMock,
      random: () => 0,
    });

    await expect(client.getEmailEvents()).rejects.toMatchObject({
      name: "BrevoApiError",
      status: 503,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it("não repete erros 4xx permanentes e preserva detalhes seguros", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: "invalid_parameter", message: "templateId inválido" }, 400),
    );
    const client = new BrevoClient({ apiKey: API_KEY, fetch: fetchMock });

    const error = await client
      .sendWhatsApp({
        templateId: 0,
        senderNumber: "5511988887777",
        contactNumbers: ["5586999999999"],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrevoApiError);
    expect(error).toMatchObject({ status: 400, code: "invalid_parameter", retryable: false });
    expect(String(error)).not.toContain(API_KEY);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("repete falha transitória de transporte e não expõe a chave", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const sleepMock = vi.fn(async (_milliseconds: number) => undefined);
    const client = new BrevoClient({
      apiKey: API_KEY,
      fetch: fetchMock,
      sleep: sleepMock,
      random: () => 0,
    });

    const error = await client.getEmailEvents().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrevoTransportError);
    expect(String(error)).not.toContain(API_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("codifica o UUID usado no caminho do conteúdo transacional", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        date: "2026-09-23T12:00:00Z",
        email: "lead@example.com",
        events: [],
        subject: "Assunto",
      }),
    );
    const client = new BrevoClient({ apiKey: API_KEY, fetch: fetchMock });

    await client.getTransactionalEmailContent("uuid/com espaço");

    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.brevo.com/v3/smtp/emails/uuid%2Fcom%20espa%C3%A7o");
  });
});
