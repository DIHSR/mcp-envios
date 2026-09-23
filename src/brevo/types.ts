export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailSender {
  email: string;
  name?: string;
}

export interface SendTransactionalEmailRequest {
  templateId: number;
  to: EmailRecipient[];
  sender?: EmailSender;
  params?: Record<string, JsonValue>;
  tags?: string[];
  headers?: Record<string, JsonValue>;
}

export interface SendTransactionalEmailResponse {
  messageId?: string;
  messageIds?: string[];
}

export interface SendWhatsAppRequest {
  templateId: number;
  senderNumber: string;
  contactNumbers: string[];
  params?: Record<string, JsonValue>;
}

export interface SendWhatsAppResponse {
  messageId: string;
}

export type BrevoEmailEventName =
  | "bounces"
  | "hardBounces"
  | "softBounces"
  | "delivered"
  | "spam"
  | "requests"
  | "opened"
  | "clicks"
  | "invalid"
  | "deferred"
  | "blocked"
  | "unsubscribed"
  | "error"
  | "loadedByProxy";

export interface EmailEvent {
  email: string;
  date: string;
  messageId: string;
  event: BrevoEmailEventName;
  subject?: string;
  reason?: string;
  tag?: string;
  ip?: string;
  link?: string;
  from?: string;
  templateId?: number;
  [key: string]: unknown;
}

export interface GetEmailEventsResponse {
  events?: EmailEvent[];
}

export interface GetEmailEventsQuery {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  days?: number;
  email?: string;
  event?: BrevoEmailEventName;
  tags?: string;
  messageId?: string;
  templateId?: number;
  sort?: "asc" | "desc";
}

export interface TransactionalEmailSummary {
  date: string;
  email: string;
  messageId: string;
  subject: string;
  uuid: string;
  templateId?: number;
  [key: string]: unknown;
}

export interface GetTransactionalEmailsResponse {
  count?: number;
  transactionalEmails?: TransactionalEmailSummary[];
}

export interface GetTransactionalEmailsQuery {
  email?: string;
  templateId?: number;
  messageId?: string;
  startDate?: string;
  endDate?: string;
  sort?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface TransactionalEmailEvent {
  name: string;
  time: string;
}

export interface TransactionalEmailContent {
  date: string;
  email: string;
  events: TransactionalEmailEvent[];
  subject: string;
  attachmentCount?: number;
  body?: string;
  templateId?: number;
  [key: string]: unknown;
}
