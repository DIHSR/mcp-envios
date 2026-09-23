import { describe, expect, it, vi } from "vitest";

import type { BrevoEventService } from "../../src/brevo/events.js";
import { extractCorrelation } from "../../src/lib/correlation.js";
import { IdempotencyCache } from "../../src/lib/idempotency.js";
import { NullLogger } from "../../src/lib/logger.js";
import type { BrevoGateway, ToolDependencies } from "../../src/tools/dependencies.js";
import { createEnviarEmailHandler, enviarEmailSchema } from "../../src/tools/enviar-email.js";
import {
  createEnviarWhatsAppHandler,
  enviarWhatsAppSchema,
} from "../../src/tools/enviar-whatsapp.js";

function createDependencies(overrides: Partial<ToolDependencies> = {}): ToolDependencies {
  const brevo: BrevoGateway = {
    sendTransactionalEmail: vi.fn().mockResolvedValue({ messageId: "message-email" }),
    sendWhatsApp: vi.fn().mockResolvedValue({ messageId: "message-whatsapp" }),
    getEmailEvents: vi.fn().mockResolvedValue({ events: [] }),
  };
  return {
    brevo,
    events: {} as BrevoEventService,
    idempotency: new IdempotencyCache(),
    logger: new NullLogger(),
    senderEmail: "sender@example.com",
    senderName: "Equipe",
    whatsappSender: "5511988887777",
    clickFilterSeconds: 60,
    dryRun: false,
    now: () => new Date("2026-09-23T12:00:00.000Z"),
    ...overrides,
  };
}

describe("ferramentas de envio", () => {
  it("marca e-mail com header e tag de correlação", async () => {
    const dependencies = createDependencies();
    const handler = createEnviarEmailHandler(dependencies);
    const input = enviarEmailSchema.parse({
      lead_id: "lead-42",
      etapa: "E4",
      template_id: 10,
      destinatario_email: "lead@example.com",
      destinatario_nome: "Lead",
      tags: ["prospeccao"],
    });

    const result = await handler(input);

    expect(result).toMatchObject({
      ok: true,
      messageId: "message-email",
      status: "enviado",
      enviado_em: "2026-09-23T12:00:00.000Z",
    });
    expect(dependencies.brevo.sendTransactionalEmail).toHaveBeenCalledOnce();
    const request = vi.mocked(dependencies.brevo.sendTransactionalEmail).mock.calls[0]?.[0];
    expect(request?.headers?.["X-Mailin-custom"]).toBe(
      JSON.stringify({ lead_id: "lead-42", etapa: "E4" }),
    );
    expect(extractCorrelation(request?.tags?.[0])).toEqual({ lead_id: "lead-42", etapa: "E4" });
    expect(request?.tags).toContain("prospeccao");
  });

  it("evita envio duplicado com a mesma chave de idempotência", async () => {
    const dependencies = createDependencies();
    const handler = createEnviarEmailHandler(dependencies);
    const input = enviarEmailSchema.parse({
      lead_id: "lead-42",
      etapa: "E1",
      template_id: 10,
      destinatario_email: "lead@example.com",
      destinatario_nome: "Lead",
      idempotency_key: "daily-lead-42-E1",
    });

    await handler(input);
    const repeated = await handler(input);

    expect(repeated).toMatchObject({ ok: true, reutilizado: true, messageId: "message-email" });
    expect(dependencies.brevo.sendTransactionalEmail).toHaveBeenCalledOnce();
  });

  it("rejeita reutilização da chave com payload diferente", async () => {
    const dependencies = createDependencies();
    const handler = createEnviarEmailHandler(dependencies);
    const baseInput = {
      lead_id: "lead-42",
      etapa: "E1" as const,
      template_id: 10,
      destinatario_email: "lead@example.com",
      destinatario_nome: "Lead",
      idempotency_key: "same-key",
    };

    await handler(enviarEmailSchema.parse(baseInput));
    const result = await handler(enviarEmailSchema.parse({ ...baseInput, template_id: 11 }));

    expect(result).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(dependencies.brevo.sendTransactionalEmail).toHaveBeenCalledOnce();
  });

  it("DRY_RUN valida e retorna resultado sem chamar o Brevo", async () => {
    const dependencies = createDependencies({ dryRun: true });
    const handler = createEnviarWhatsAppHandler(dependencies);
    const input = enviarWhatsAppSchema.parse({
      lead_id: "lead-42",
      toque: "A",
      template_id: 77,
      destinatario_telefone: "+55 (86) 99999-9999",
    });

    const result = await handler(input);

    expect(result).toMatchObject({
      ok: true,
      status: "dry_run",
      destinatario_telefone: "5586999999999",
    });
    expect(dependencies.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("retorna erro claro para telefone inválido", async () => {
    const dependencies = createDependencies();
    const handler = createEnviarWhatsAppHandler(dependencies);
    const input = enviarWhatsAppSchema.parse({
      lead_id: "lead-42",
      toque: "A",
      template_id: 77,
      destinatario_telefone: "telefone com ramal 1",
    });

    const result = await handler(input);

    expect(result).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(dependencies.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });
});
