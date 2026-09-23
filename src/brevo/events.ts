import type {
  BrevoEmailEventName,
  EmailEvent,
  GetEmailEventsQuery,
  GetEmailEventsResponse,
} from "./types.js";
import { extractCorrelation } from "../lib/correlation.js";
import type { Logger } from "../lib/logger.js";

const BREVO_MAX_PAGE_SIZE = 5_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const MAX_WINDOW_DAYS_INCLUSIVE = 90;

export const NORMALIZED_EVENT_NAMES = [
  "bounce",
  "hard_bounce",
  "soft_bounce",
  "delivered",
  "spam",
  "request",
  "opened",
  "click",
  "invalid",
  "deferred",
  "blocked",
  "unsubscribed",
  "error",
  "loaded_by_proxy",
] as const;

export type NormalizedEventName = (typeof NORMALIZED_EVENT_NAMES)[number];

export interface NormalizedEmailEvent {
  email: string;
  message_id: string;
  evento: NormalizedEventName;
  data_hora: string;
  link: string | null;
  lead_id: string | null;
  etapa: string | null;
  tag: string | null;
}

export interface ListNormalizedEventsInput {
  desde: string;
  ate: string;
  eventos: NormalizedEventName[];
  email?: string;
  message_id?: string;
  limite: number;
}

export interface EmailEventsGateway {
  getEmailEvents(
    query?: GetEmailEventsQuery,
    signal?: AbortSignal,
  ): Promise<GetEmailEventsResponse>;
}

export class BrevoEventService {
  constructor(
    private readonly gateway: EmailEventsGateway,
    private readonly logger: Logger,
  ) {}

  async list(input: ListNormalizedEventsInput, signal?: AbortSignal): Promise<NormalizedEmailEvent[]> {
    const fromMs = Date.parse(input.desde);
    const toMs = Date.parse(input.ate);
    if (fromMs > toMs) {
      throw new RangeError("O campo desde deve ser anterior ou igual ao campo ate.");
    }

    const requestedEvents = new Set(input.eventos);
    const windows = createDateWindows(fromMs, toMs);
    const result: NormalizedEmailEvent[] = [];
    const serverEvent = getSingleServerEvent(input.eventos);

    for (const window of windows) {
      let offset = 0;

      while (result.length < input.limite) {
        const query: GetEmailEventsQuery = {
          startDate: window.startDate,
          endDate: window.endDate,
          limit: BREVO_MAX_PAGE_SIZE,
          offset,
          sort: "asc",
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.message_id === undefined ? {} : { messageId: input.message_id }),
          ...(serverEvent === undefined ? {} : { event: serverEvent }),
        };
        const page = await this.gateway.getEmailEvents(query, signal);
        const events = page.events ?? [];

        for (const event of events) {
          const normalized = normalizeEmailEvent(event);
          if (normalized === undefined) {
            this.logger.log("error", "evento_brevo_invalido", {
              ferramenta: "brevo_listar_eventos",
              message_id: event.messageId,
            });
            continue;
          }

          const timestamp = Date.parse(normalized.data_hora);
          if (
            timestamp < fromMs ||
            timestamp > toMs ||
            !requestedEvents.has(normalized.evento)
          ) {
            continue;
          }

          result.push(normalized);
          if (result.length === input.limite) {
            break;
          }
        }

        if (events.length < BREVO_MAX_PAGE_SIZE) {
          break;
        }
        offset += events.length;
      }

      if (result.length === input.limite) {
        break;
      }
    }

    return result;
  }
}

export function normalizeEmailEvent(event: EmailEvent): NormalizedEmailEvent | undefined {
  const eventName = normalizeEventName(event.event);
  const timestamp = Date.parse(event.date);
  if (eventName === undefined || Number.isNaN(timestamp)) {
    return undefined;
  }

  const correlation = extractCorrelation(event.tag);
  return {
    email: event.email,
    message_id: event.messageId,
    evento: eventName,
    data_hora: new Date(timestamp).toISOString(),
    link: event.link ?? null,
    lead_id: correlation?.lead_id ?? null,
    etapa: correlation?.etapa ?? null,
    tag: event.tag ?? null,
  };
}

export function normalizeEventName(value: string): NormalizedEventName | undefined {
  const aliases: Readonly<Record<string, NormalizedEventName>> = {
    bounces: "bounce",
    bounce: "bounce",
    hardBounces: "hard_bounce",
    hardBounce: "hard_bounce",
    softBounces: "soft_bounce",
    softBounce: "soft_bounce",
    delivered: "delivered",
    spam: "spam",
    requests: "request",
    request: "request",
    opened: "opened",
    clicks: "click",
    click: "click",
    invalid: "invalid",
    deferred: "deferred",
    blocked: "blocked",
    unsubscribed: "unsubscribed",
    error: "error",
    loadedByProxy: "loaded_by_proxy",
  };
  return aliases[value];
}

function getSingleServerEvent(
  events: NormalizedEventName[],
): BrevoEmailEventName | undefined {
  if (events.length !== 1) {
    return undefined;
  }

  const names: Readonly<Record<NormalizedEventName, BrevoEmailEventName>> = {
    bounce: "bounces",
    hard_bounce: "hardBounces",
    soft_bounce: "softBounces",
    delivered: "delivered",
    spam: "spam",
    request: "requests",
    opened: "opened",
    click: "clicks",
    invalid: "invalid",
    deferred: "deferred",
    blocked: "blocked",
    unsubscribed: "unsubscribed",
    error: "error",
    loaded_by_proxy: "loadedByProxy",
  };
  const event = events[0];
  return event === undefined ? undefined : names[event];
}

function createDateWindows(fromMs: number, toMs: number): Array<{
  startDate: string;
  endDate: string;
}> {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const finalDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const windows: Array<{ startDate: string; endDate: string }> = [];

  while (cursor <= finalDay) {
    const lastAllowedDay = cursor + (MAX_WINDOW_DAYS_INCLUSIVE - 1) * MILLISECONDS_PER_DAY;
    const end = Math.min(lastAllowedDay, finalDay);
    windows.push({ startDate: toDateOnly(cursor), endDate: toDateOnly(end) });
    cursor = end + MILLISECONDS_PER_DAY;
  }

  return windows;
}

function toDateOnly(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
