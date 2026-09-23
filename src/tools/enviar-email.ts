import { z } from "zod/v4";

import { BrevoApiError } from "../brevo/errors.js";
import {
  createCorrelationHeader,
  createCorrelationTag,
  type EmailCorrelation,
} from "../lib/correlation.js";
import { fingerprint } from "../lib/idempotency.js";
import type { ToolDependencies } from "./dependencies.js";
import { executeTool, type ToolOutcome, type ToolSuccess } from "./result.js";
import {
  emailSchema,
  idempotencyKeySchema,
  jsonObjectSchema,
  leadIdSchema,
  userTagsSchema,
} from "./schemas.js";

export const enviarEmailSchema = z.object({
  lead_id: leadIdSchema,
  etapa: z.enum(["E1", "E2", "E3", "E4", "E5"]),
  template_id: z.number().int().positive(),
  destinatario_email: emailSchema,
  destinatario_nome: z.string().trim().min(1).max(200),
  params: jsonObjectSchema.optional(),
  tags: userTagsSchema,
  idempotency_key: idempotencyKeySchema,
});

export type EnviarEmailInput = z.infer<typeof enviarEmailSchema>;

export interface EnviarEmailOutput {
  messageId: string;
  enviado_em: string;
  status: "enviado" | "dry_run";
  reutilizado?: boolean;
}

export function createEnviarEmailHandler(dependencies: ToolDependencies) {
  return async (input: EnviarEmailInput): Promise<ToolOutcome<EnviarEmailOutput>> =>
    await executeTool(
      "brevo_enviar_email",
      dependencies.logger,
      async () => await sendEmail(input, dependencies),
      input.lead_id,
    );
}

async function sendEmail(
  input: EnviarEmailInput,
  dependencies: ToolDependencies,
): Promise<ToolSuccess<EnviarEmailOutput>> {
  const correlation: EmailCorrelation = { lead_id: input.lead_id, etapa: input.etapa };
  const correlationTag = createCorrelationTag(correlation);
  const tags = [correlationTag, ...new Set(input.tags ?? [])];
  const request = {
    templateId: input.template_id,
    to: [{ email: input.destinatario_email, name: input.destinatario_nome }],
    sender: { email: dependencies.senderEmail, name: dependencies.senderName },
    ...(input.params === undefined ? {} : { params: input.params }),
    tags,
    headers: { "X-Mailin-custom": createCorrelationHeader(correlation) },
  };
  const requestFingerprint = fingerprint(request);
  const cached = getCachedResult(input.idempotency_key, requestFingerprint, dependencies);
  if (cached !== undefined) {
    return { ok: true, ...cached, reutilizado: true };
  }

  const sentAt = (dependencies.now ?? (() => new Date()))().toISOString();
  let output: EnviarEmailOutput;
  if (dependencies.dryRun) {
    dependencies.logger.log("info", "dry_run_envio", {
      ferramenta: "brevo_enviar_email",
      lead_id: input.lead_id,
      template_id: input.template_id,
    });
    output = {
      messageId: `dry-run:${requestFingerprint.slice(0, 24)}`,
      enviado_em: sentAt,
      status: "dry_run",
    };
  } else {
    const response = await dependencies.brevo.sendTransactionalEmail(request);
    if (response.messageId === undefined) {
      throw new BrevoApiError("A API do Brevo não retornou messageId.", {
        status: 502,
        response,
        retryable: false,
      });
    }
    output = { messageId: response.messageId, enviado_em: sentAt, status: "enviado" };
  }

  if (input.idempotency_key !== undefined) {
    dependencies.idempotency.set(
      "brevo_enviar_email",
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
): EnviarEmailOutput | undefined {
  if (key === undefined) {
    return undefined;
  }

  const lookup = dependencies.idempotency.get<EnviarEmailOutput>(
    "brevo_enviar_email",
    key,
    requestFingerprint,
  );
  if (lookup.status === "conflict") {
    throw new TypeError("A idempotency_key já foi usada com dados de envio diferentes.");
  }
  return lookup.status === "hit" ? lookup.value : undefined;
}
