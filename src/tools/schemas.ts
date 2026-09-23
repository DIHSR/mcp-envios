import { z } from "zod/v4";

import { NORMALIZED_EVENT_NAMES } from "../brevo/events.js";
import { isIsoDateTime } from "../lib/validation.js";

export const jsonObjectSchema = z.record(z.string(), z.json());

export const leadIdSchema = z.string().trim().min(1).max(200);
export const idempotencyKeySchema = z.string().trim().min(1).max(256).optional();
export const emailSchema = z.string().trim().email().max(320);
export const isoDateTimeSchema = z
  .string()
  .refine(isIsoDateTime, "Use uma data ISO 8601 completa com fuso horário.");
export const eventNameSchema = z.enum(NORMALIZED_EVENT_NAMES);

export const userTagsSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(20)
  .optional();
