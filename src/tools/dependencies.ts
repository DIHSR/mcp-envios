import type {
  GetEmailEventsQuery,
  GetEmailEventsResponse,
  SendTransactionalEmailRequest,
  SendTransactionalEmailResponse,
  SendWhatsAppRequest,
  SendWhatsAppResponse,
} from "../brevo/types.js";
import type { BrevoEventService } from "../brevo/events.js";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { Logger } from "../lib/logger.js";

export interface BrevoGateway {
  sendTransactionalEmail(
    request: SendTransactionalEmailRequest,
    signal?: AbortSignal,
  ): Promise<SendTransactionalEmailResponse>;
  sendWhatsApp(
    request: SendWhatsAppRequest,
    signal?: AbortSignal,
  ): Promise<SendWhatsAppResponse>;
  getEmailEvents(
    query?: GetEmailEventsQuery,
    signal?: AbortSignal,
  ): Promise<GetEmailEventsResponse>;
}

export interface ToolDependencies {
  brevo: BrevoGateway;
  events: BrevoEventService;
  idempotency: IdempotencyCache;
  logger: Logger;
  senderEmail: string;
  senderName: string;
  whatsappSender: string;
  clickFilterSeconds: number;
  dryRun: boolean;
  now?: () => Date;
}
