/**
 * Commerce payment links (FIAT or CRYPTO charge kind): Paystack settles fiat; no on-chain send to merchant.
 * Shared by webhook and GET /api/paystack/transactions/verify so status/emails update when webhooks are missed.
 */

import { prisma } from "../lib/prisma.js";
import { computeTransactionFee } from "./fee.service.js";
import { triggerTransactionStatusChange } from "./pusher.service.js";
import { sendPaymentLinkPaystackSuccessEmails } from "./notification.service.js";
import { getEnv } from "../config/env.js";
import type { Transaction } from "../../prisma/generated/prisma/client.js";

export type CommerceSettlementResult = {
  /** Rows updated (1 if we transitioned PENDING → COMPLETED, 0 if already settled or not applicable). */
  updatedCount: number;
  /** True when this transaction is not a commerce Paystack link (caller may run onramp/request logic). */
  notApplicable: boolean;
};

function isCommercePaystackSettlement(
  tx: Transaction,
  paymentLink: { chargeKind: string | null } | null
): boolean {
  if (tx.type !== "BUY" || !paymentLink) return false;
  const linkChargeKind = (paymentLink.chargeKind ?? "FIAT").toString().toUpperCase();
  return linkChargeKind === "FIAT" || linkChargeKind === "CRYPTO";
}

/**
 * Mark commerce BUY as COMPLETED after Paystack success, send receipt emails, one-time link, Pusher.
 * Idempotent: if already COMPLETED or reference mismatch, returns updatedCount 0.
 */
export async function settleCommercePaystackTransaction(params: {
  transactionId: string;
  reference: string;
  payerEmail?: string | null;
}): Promise<CommerceSettlementResult> {
  const { transactionId, reference } = params;
  const ref = reference.trim();

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
  });
  if (!tx || tx.providerSessionId !== ref) {
    return { updatedCount: 0, notApplicable: false };
  }

  const paymentLink = tx.paymentLinkId
    ? await prisma.paymentLink.findUnique({
        where: { id: tx.paymentLinkId },
        select: {
          id: true,
          chargeKind: true,
          title: true,
          publicCode: true,
          isOneTime: true,
        },
      })
    : null;

  if (!isCommercePaystackSettlement(tx, paymentLink)) {
    return { updatedCount: 0, notApplicable: true };
  }

  const feeAmount = computeTransactionFee(tx);
  const updateResult = await prisma.transaction.updateMany({
    where: {
      id: transactionId,
      status: "PENDING",
      providerSessionId: ref,
    },
    data: {
      status: "COMPLETED",
      paymentConfirmedAt: new Date(),
      ...(Number.isFinite(feeAmount) ? { fee: feeAmount, platformFee: feeAmount } : {}),
    },
  });

  if (updateResult.count === 0) {
    // Already COMPLETED (or mismatch): no duplicate emails on verify refresh / webhook retry.
    return { updatedCount: 0, notApplicable: false };
  }

  const business = tx.businessId
    ? await prisma.business.findUnique({
        where: { id: tx.businessId },
        select: { name: true, supportEmail: true },
      })
    : null;

  const payerEmail =
    params.payerEmail?.trim() ||
    (tx.fromIdentifier?.includes("@") ? tx.fromIdentifier.trim() : null);
  const fiatAmount = Number(tx.f_amount);
  const fiatCurrency = (tx.f_token ?? "USD").toString();
  const env = getEnv();

  void sendPaymentLinkPaystackSuccessEmails({
    transactionId,
    paystackReference: ref,
    payerEmail,
    platformPaystackEmail: env.PAYSTACK_PLATFORM_EMAIL ?? null,
    fiatAmount,
    fiatCurrency,
    merchantSupportEmail: business?.supportEmail ?? null,
    businessName: business?.name ?? "Your business",
    linkTitle: paymentLink!.title ?? "Payment link",
    linkPublicCode: paymentLink!.publicCode ?? "",
  }).catch(() => {});

  if (tx.paymentLinkId && paymentLink?.isOneTime) {
    await prisma.paymentLink.updateMany({
      where: { id: tx.paymentLinkId, isOneTime: true, paidAt: null },
      data: {
        paidAt: new Date(),
        paidByTransactionId: transactionId,
        paidByWalletAddress: null,
      },
    });
  }

  await triggerTransactionStatusChange({
    transactionId,
    status: "COMPLETED",
    type: "BUY",
  }).catch(() => {});

  return { updatedCount: updateResult.count, notApplicable: false };
}
