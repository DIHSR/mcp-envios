import { z } from "zod/v4";

import { normalizeEmailEvent, type NormalizedEmailEvent } from "../brevo/events.js";
import type { ToolDependencies } from "./dependencies.js";
import { executeTool, type ToolOutcome } from "./result.js";

export const statusEnvioSchema = z.object({
  message_id: z.string().trim().min(1).max(500),
});

export type StatusEnvioInput = z.infer<typeof statusEnvioSchema>;

export interface StatusEnvioOutput {
  message_id: string;
  encontrado: boolean;
  status: string;
  atualizado_em: string | null;
  eventos: NormalizedEmailEvent[];
}

export function createStatusEnvioHandler(dependencies: ToolDependencies) {
  return async (input: StatusEnvioInput): Promise<ToolOutcome<StatusEnvioOutput>> =>
    await executeTool("brevo_status_envio", dependencies.logger, async () => {
      const response = await dependencies.brevo.getEmailEvents({
        messageId: input.message_id,
        limit: 5_000,
        offset: 0,
        sort: "asc",
      });
      const events = (response.events ?? [])
        .map(normalizeEmailEvent)
        .filter((event): event is NormalizedEmailEvent => event !== undefined)
        .sort((left, right) => Date.parse(left.data_hora) - Date.parse(right.data_hora));
      const latest = events.at(-1);

      return {
        ok: true,
        message_id: input.message_id,
        encontrado: latest !== undefined,
        status: latest?.evento ?? "desconhecido",
        atualizado_em: latest?.data_hora ?? null,
        eventos: events,
      };
    });
}
