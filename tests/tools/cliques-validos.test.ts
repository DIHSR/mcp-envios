import { describe, expect, it, vi } from "vitest";

import type { NormalizedEmailEvent } from "../../src/brevo/events.js";
import { NullLogger, type Logger } from "../../src/lib/logger.js";
import { classifyClicks } from "../../src/tools/cliques-validos.js";

function event(
  evento: "delivered" | "click",
  data_hora: string,
  overrides: Partial<NormalizedEmailEvent> = {},
): NormalizedEmailEvent {
  return {
    email: "lead@example.com",
    message_id: "message-1",
    evento,
    data_hora,
    link: evento === "click" ? "https://example.com/case" : null,
    lead_id: "lead-123",
    etapa: "E2",
    tag: null,
    ...overrides,
  };
}

describe("filtro anti-robô", () => {
  it("classifica clique abaixo do limite como suspeito", () => {
    const result = classifyClicks(
      [
        event("delivered", "2026-09-23T12:00:00.000Z"),
        event("click", "2026-09-23T12:00:15.000Z"),
      ],
      60,
      undefined,
      { logger: new NullLogger() },
    );

    expect(result.validos).toEqual([]);
    expect(result.suspeitos).toHaveLength(1);
    expect(result.suspeitos[0]?.delta_segundos).toBe(15);
  });

  it("classifica clique acima do limite como válido", () => {
    const result = classifyClicks(
      [
        event("delivered", "2026-09-23T12:00:00.000Z"),
        event("click", "2026-09-23T12:02:01.000Z"),
      ],
      60,
      undefined,
      { logger: new NullLogger() },
    );

    expect(result.suspeitos).toEqual([]);
    expect(result.validos[0]?.delta_segundos).toBe(121);
  });

  it("considera válido o clique sem entrega e registra o caso", () => {
    const log = vi.fn<Logger["log"]>();
    const result = classifyClicks(
      [event("click", "2026-09-23T12:02:01.000Z")],
      60,
      undefined,
      { logger: { log } },
    );

    expect(result.validos[0]).toMatchObject({
      data_hora_entrega: null,
      delta_segundos: null,
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "clique_sem_entrega",
      expect.objectContaining({ message_id: "message-1" }),
    );
  });

  it("ignora clique cujo link não contém o trecho solicitado", () => {
    const result = classifyClicks(
      [
        event("delivered", "2026-09-23T12:00:00.000Z"),
        event("click", "2026-09-23T12:02:01.000Z", {
          link: "https://example.com/outro",
        }),
      ],
      60,
      "/case",
      { logger: new NullLogger() },
    );

    expect(result).toEqual({ validos: [], suspeitos: [] });
  });
});
