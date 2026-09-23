import { z } from "zod/v4";

import type { NormalizedEmailEvent } from "../brevo/events.js";
import { toUtcIso } from "../lib/validation.js";
import type { ToolDependencies } from "./dependencies.js";
import { executeTool, type ToolOutcome } from "./result.js";
import { emailSchema, eventNameSchema, isoDateTimeSchema } from "./schemas.js";

export const listarEventosSchema = z.object({
  desde: isoDateTimeSchema,
  ate: isoDateTimeSchema.optional(),
  eventos: z.array(eventNameSchema).min(1).max(14).default(["delivered", "click"]),
  email: emailSchema.optional(),
  message_id: z.string().trim().min(1).max(500).optional(),
  limite: z.number().int().min(1).max(5_000).default(500),
});

export type ListarEventosInput = z.infer<typeof listarEventosSchema>;

export interface ListarEventosOutput {
  eventos: NormalizedEmailEvent[];
  total: number;
}

export function createListarEventosHandler(dependencies: ToolDependencies) {
  return async (input: ListarEventosInput): Promise<ToolOutcome<ListarEventosOutput>> =>
    await executeTool("brevo_listar_eventos", dependencies.logger, async () => {
      const now = dependencies.now ?? (() => new Date());
      const events = await dependencies.events.list({
        desde: toUtcIso(input.desde),
        ate: input.ate === undefined ? now().toISOString() : toUtcIso(input.ate),
        eventos: input.eventos,
        limite: input.limite,
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.message_id === undefined ? {} : { message_id: input.message_id }),
      });
      return { ok: true, eventos: events, total: events.length };
    });
}
