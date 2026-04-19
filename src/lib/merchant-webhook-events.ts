import { z } from "zod";

/** Outbound merchant webhook event identifiers (v1). Keep in sync with klyra-admin `src/lib/merchant-webhook-events.ts`. */
export const MERCHANT_WEBHOOK_EVENT_TYPES = [
  "transaction.created",
  "transaction.status_updated",
  "invoice.created",
  "invoice.paid",
  "payout.status_updated",
  "payment_link.paid",
] as const;

export type MerchantWebhookEventType = (typeof MERCHANT_WEBHOOK_EVENT_TYPES)[number];

export const merchantWebhookEventTypeSchema = z.enum(MERCHANT_WEBHOOK_EVENT_TYPES);
