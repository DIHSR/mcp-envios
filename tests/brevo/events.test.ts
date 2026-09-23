import { describe, expect, it, vi } from "vitest";

import { BrevoEventService } from "../../src/brevo/events.js";
import type { EmailEvent } from "../../src/brevo/types.js";
import { createCorrelationTag } from "../../src/lib/correlation.js";
import { NullLogger } from "../../src/lib/logger.js";

function rawEvent(overrides: Partial<EmailEvent> = {}): EmailEvent {
  return {
    email: "lead@example.com",
    date: "2026-09-23T12:00:00Z",
    messageId: "message-1",
    event: "clicks",
    link: "https://example.com/case",
    tag: createCorrelationTag({ lead_id: "lead-123", etapa: "E3" }),
    ...overrides,
  };
}

describe("BrevoEventService", () => {
  it("normaliza nomes, correlação e aplica o recorte exato de horário", async () => {
    const getEmailEvents = vi.fn().mockResolvedValue({
      events: [
        rawEvent({ date: "2026-09-23T09:59:59Z" }),
        rawEvent({ date: "2026-09-23T10:00:00Z" }),
        rawEvent({ date: "2026-09-23T11:00:00Z", event: "opened" }),
      ],
    });
    const service = new BrevoEventService({ getEmailEvents }, new NullLogger());

    const result = await service.list({
      desde: "2026-09-23T10:00:00.000Z",
      ate: "2026-09-23T12:00:00.000Z",
      eventos: ["click"],
      limite: 500,
    });

    expect(result).toEqual([
      expect.objectContaining({
        evento: "click",
        data_hora: "2026-09-23T10:00:00.000Z",
        lead_id: "lead-123",
        etapa: "E3",
      }),
    ]);
    expect(getEmailEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-23",
        endDate: "2026-09-23",
        event: "clicks",
      }),
      undefined,
    );
  });

  it("divide intervalos maiores que 90 dias", async () => {
    const getEmailEvents = vi.fn().mockResolvedValue({ events: [] });
    const service = new BrevoEventService({ getEmailEvents }, new NullLogger());

    await service.list({
      desde: "2026-01-01T00:00:00.000Z",
      ate: "2026-04-15T23:59:59.000Z",
      eventos: ["click", "delivered"],
      limite: 500,
    });

    expect(getEmailEvents).toHaveBeenCalledTimes(2);
    expect(getEmailEvents.mock.calls[0]?.[0]).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });
    expect(getEmailEvents.mock.calls[1]?.[0]).toMatchObject({
      startDate: "2026-04-01",
      endDate: "2026-04-15",
    });
  });

  it("rejeita intervalo invertido", async () => {
    const service = new BrevoEventService(
      { getEmailEvents: vi.fn().mockResolvedValue({ events: [] }) },
      new NullLogger(),
    );

    await expect(
      service.list({
        desde: "2026-09-24T00:00:00.000Z",
        ate: "2026-09-23T00:00:00.000Z",
        eventos: ["click"],
        limite: 500,
      }),
    ).rejects.toThrow("desde");
  });
});
