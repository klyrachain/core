/**
 * Persist Paystack transfer (payout) data for dashboard review and audit.
 */

import { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import type { PaystackTransferVerifyData } from "./paystack.service.js";

export type CreateTransferRecordParams = {
  reference: string;
  transfer_code: string;
  amount: number;
  currency: string;
  status: string;
  payout_request_id?: string | null;
  recipient_name?: string | null;
  reason?: string | null;
  raw_response?: PaystackTransferVerifyData | object | null;
};

/**
 * Create a Paystack transfer record after executing a payout. Used for dashboard and audit.
 */
export async function createPaystackTransferRecord(params: CreateTransferRecordParams): Promise<void> {
  await prisma.paystackTransferRecord.create({
    data: {
      reference: params.reference,
      transferCode: params.transfer_code,
      payoutRequestId: params.payout_request_id ?? null,
      amount: params.amount,
      currency: params.currency,
      status: params.status,
      recipientName: params.recipient_name ?? null,
      reason: params.reason ?? null,
      rawResponse: params.raw_response ? (params.raw_response as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}
