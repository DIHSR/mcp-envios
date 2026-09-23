import { z } from "zod/v4";

import type { NormalizedEmailEvent } from "../brevo/events.js";
import { toUtcIso } from "../lib/validation.js";
import type { ToolDependencies } from "./dependencies.js";
import { executeTool, type ToolOutcome } from "./result.js";
import { isoDateTimeSchema } from "./schemas.js";

export const cliquesValidosSchema = z.object({
  desde: isoDateTimeSchema,
  ate: isoDateTimeSchema.optional(),
  limite_segundos: z.number().finite().min(0).max(86_400).optional(),
  link_contem: z.string().min(1).max(2_048).optional(),
});

export type CliquesValidosInput = z.infer<typeof cliquesValidosSchema>;

export interface ClassifiedClick {
  lead_id: string | null;
  etapa: string | null;
  email: string;
  message_id: string;
  link: string | null;
  data_hora_clique: string;
  data_hora_entrega: string | null;
  delta_segundos: number | null;
}

export interface CliquesValidosOutput {
  validos: ClassifiedClick[];
  suspeitos: ClassifiedClick[];
}

export function createCliquesValidosHandler(dependencies: ToolDependencies) {
  return async (input: CliquesValidosInput): Promise<ToolOutcome<CliquesValidosOutput>> =>
    await executeTool("brevo_cliques_validos", dependencies.logger, async () => {
      const now = dependencies.now ?? (() => new Date());
      const events = await dependencies.events.list({
        desde: toUtcIso(input.desde),
        ate: input.ate === undefined ? now().toISOString() : toUtcIso(input.ate),
        eventos: ["delivered", "click"],
        limite: 5_000,
      });
      const result = classifyClicks(
        events,
        input.limite_segundos ?? dependencies.clickFilterSeconds,
        input.link_contem,
        dependencies,
      );
      return { ok: true, ...result };
    });
}

export function classifyClicks(
  events: NormalizedEmailEvent[],
  thresholdSeconds: number,
  linkContains: string | undefined,
  dependencies: Pick<ToolDependencies, "logger">,
): CliquesValidosOutput {
  const deliveries = new Map<string, NormalizedEmailEvent[]>();
  for (const event of events) {
    if (event.evento === "delivered") {
      const current = deliveries.get(event.message_id) ?? [];
      current.push(event);
      deliveries.set(event.message_id, current);
    }
  }

  for (const messageDeliveries of deliveries.values()) {
    messageDeliveries.sort((left, right) => Date.parse(left.data_hora) - Date.parse(right.data_hora));
  }

  const validos: ClassifiedClick[] = [];
  const suspeitos: ClassifiedClick[] = [];
  for (const click of events) {
    if (
      click.evento !== "click" ||
      (linkContains !== undefined && !click.link?.includes(linkContains))
    ) {
      continue;
    }

    const delivery = selectDelivery(deliveries.get(click.message_id), click.data_hora);
    const deltaSeconds =
      delivery === undefined
        ? null
        : (Date.parse(click.data_hora) - Date.parse(delivery.data_hora)) / 1_000;
    const classified: ClassifiedClick = {
      lead_id: click.lead_id ?? delivery?.lead_id ?? null,
      etapa: click.etapa ?? delivery?.etapa ?? null,
      email: click.email,
      message_id: click.message_id,
      link: click.link,
      data_hora_clique: click.data_hora,
      data_hora_entrega: delivery?.data_hora ?? null,
      delta_segundos: deltaSeconds,
    };

    if (delivery === undefined) {
      dependencies.logger.log("info", "clique_sem_entrega", {
        ferramenta: "brevo_cliques_validos",
        lead_id: click.lead_id,
        message_id: click.message_id,
      });
      validos.push(classified);
    } else if (deltaSeconds !== null && deltaSeconds < thresholdSeconds) {
      suspeitos.push(classified);
    } else {
      validos.push(classified);
    }
  }

  return { validos, suspeitos };
}

function selectDelivery(
  deliveries: NormalizedEmailEvent[] | undefined,
  clickTime: string,
): NormalizedEmailEvent | undefined {
  if (deliveries === undefined || deliveries.length === 0) {
    return undefined;
  }

  const clickTimestamp = Date.parse(clickTime);
  const beforeClick = deliveries.filter((delivery) => Date.parse(delivery.data_hora) <= clickTimestamp);
  return beforeClick.at(-1) ?? deliveries[0];
}
