import { z } from "zod/v4";

import { BrevoApiError } from "../brevo/errors.js";
import { fingerprint } from "../lib/idempotency.js";
import { normalizePhone } from "../lib/validation.js";
import type { ToolDependencies } from "./dependencies.js";
import { executeTool, type ToolOutcome, type ToolSuccess } from "./result.js";
import { idempotencyKeySchema, jsonObjectSchema, leadIdSchema } from "./schemas.js";

export const enviarWhatsAppSchema = z.object({
  lead_id: leadIdSchema,
  toque: z.enum(["A", "B", "C", "D", "E"]),
  template_id: z.number().int().positive(),
  destinatario_telefone: z.string().trim().min(1).max(40),
  params: jsonObjectSchema.optional(),
  idempotency_key: idempotencyKeySchema,
});

export type EnviarWhatsAppInput = z.infer<typeof enviarWhatsAppSchema>;

export interface EnviarWhatsAppOutput {
  messageId: string;
  enviado_em: string;
  status: "enviado" | "dry_run";
  destinatario_telefone: string;
  reutilizado?: boolean;
}

export function createEnviarWhatsAppHandler(dependencies: ToolDependencies) {
  return async (input: EnviarWhatsAppInput): Promise<ToolOutcome<EnviarWhatsAppOutput>> =>
    await executeTool(
      "brevo_enviar_whatsapp",
      dependencies.logger,
      async () => await sendWhatsApp(input, dependencies),
      input.lead_id,
    );
}

async function sendWhatsApp(
  input: EnviarWhatsAppInput,
  dependencies: ToolDependencies,
): Promise<ToolSuccess<EnviarWhatsAppOutput>> {
  const recipient = normalizePhone(input.destinatario_telefone);
  const sender = normalizePhone(dependencies.whatsappSender);
  const request = {
    templateId: input.template_id,
    senderNumber: sender,
    contactNumbers: [recipient],
    ...(input.params === undefined ? {} : { params: input.params }),
  };
  const requestFingerprint = fingerprint({ ...request, toque: input.toque, lead_id: input.lead_id });
  const cached = getCachedResult(input.idempotency_key, requestFingerprint, dependencies);
  if (cached !== undefined) {
    return { ok: true, ...cached, reutilizado: true };
  }

  const sentAt = (dependencies.now ?? (() => new Date()))().toISOString();
  let output: EnviarWhatsAppOutput;
  if (dependencies.dryRun) {
    dependencies.logger.log("info", "dry_run_envio", {
      ferramenta: "brevo_enviar_whatsapp",
      lead_id: input.lead_id,
      template_id: input.template_id,
    });
    output = {
      messageId: `dry-run:${requestFingerprint.slice(0, 24)}`,
      enviado_em: sentAt,
      status: "dry_run",
      destinatario_telefone: recipient,
    };
  } else {
    const response = await dependencies.brevo.sendWhatsApp(request);
    if (response.messageId.length === 0) {
      throw new BrevoApiError("A API do Brevo não retornou messageId.", {
        status: 502,
        response,
        retryable: false,
      });
    }
    output = {
      messageId: response.messageId,
      enviado_em: sentAt,
      status: "enviado",
      destinatario_telefone: recipient,
    };
  }

  if (input.idempotency_key !== undefined) {
    dependencies.idempotency.set(
      "brevo_enviar_whatsapp",
      input.idempotency_key,
      requestFingerprint,
      output,
    );
  }
  return { ok: true, ...output };
}

function getCachedResult(
  key: string | undefined,
  requestFingerprint: string,
  dependencies: ToolDependencies,
): EnviarWhatsAppOutput | undefined {
  if (key === undefined) {
    return undefined;
  }

  const lookup = dependencies.idempotency.get<EnviarWhatsAppOutput>(
    "brevo_enviar_whatsapp",
    key,
    requestFingerprint,
  );
  if (lookup.status === "conflict") {
    throw new TypeError("A idempotency_key já foi usada com dados de envio diferentes.");
  }
  return lookup.status === "hit" ? lookup.value : undefined;
}
