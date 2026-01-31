/**
 * Persist Paystack transaction data for cross-checks and disputes.
 * Paystack: store transaction ID as unsigned 64-bit; we use String for paystackId to avoid JS precision.
 */

import { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import type { PaystackTransactionData } from "./paystack.service.js";
import { sanitizeTransactionData } from "./paystack.service.js";

/**
 * Upsert a Paystack payment record from verify/fetch response.
 * Call after verify or from webhook (after calling verify to get full data).
 */
export async function upsertPaystackPaymentRecord(
  data: PaystackTransactionData,
  ourTransactionId?: string | null
): Promise<void> {
  const paystackId = String(data.id); // Store as string per Paystack 64-bit guidance
  const paidAt = data.paid_at ? new Date(data.paid_at) : null;
  const amount = data.amount != null ? data.amount : null;
  const customerEmail = data.customer?.email ?? null;

  await prisma.paystackPaymentRecord.upsert({
    where: { reference: data.reference },
    create: {
      reference: data.reference,
      paystackId,
      transactionId: ourTransactionId ?? null,
      status: data.status,
      amount,
      currency: data.currency ?? null,
      paidAt,
      channel: data.channel ?? null,
      gatewayResponse: data.gateway_response ?? null,
      customerEmail,
      metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      rawResponse: sanitizeTransactionData(data) as Prisma.InputJsonValue,
    },
    update: {
      paystackId,
      transactionId: ourTransactionId ?? undefined,
      status: data.status,
      amount,
      currency: data.currency ?? null,
      paidAt,
      channel: data.channel ?? null,
      gatewayResponse: data.gateway_response ?? null,
      customerEmail,
      metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      rawResponse: sanitizeTransactionData(data) as Prisma.InputJsonValue,
    },
  });
}
