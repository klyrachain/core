import { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

function toDecimal(amount: number): InstanceType<typeof Prisma.Decimal> {
  return new Prisma.Decimal(amount.toFixed(8));
}

export type PaymentLinkPurposeMeta = {
  purpose?: string;
};

export function parsePaymentLinkPurpose(
  metadata: unknown
): "GAS_TOPUP_FIAT" | "GAS_TOPUP_CRYPTO" | null {
  if (!metadata || typeof metadata !== "object") return null;
  const p = (metadata as PaymentLinkPurposeMeta).purpose;
  if (p === "GAS_TOPUP_FIAT" || p === "GAS_TOPUP_CRYPTO") return p;
  return null;
}

/**
 * Net USD credited to merchant clearing from a completed commerce Paystack transaction (fiat leg).
 */
export function commerceNetUsdForClearing(tx: {
  f_amount: { toString(): string };
  f_token: string | null;
  platformFee: { toString(): string } | null;
}): number | null {
  const token = (tx.f_token ?? "").trim().toUpperCase();
  if (token !== "USD") return null;
  const gross = Number(tx.f_amount.toString());
  if (!Number.isFinite(gross) || gross <= 0) return null;
  const fee = Number((tx.platformFee ?? 0).toString() || 0);
  const net = gross - (Number.isFinite(fee) ? fee : 0);
  return net > 0 ? net : 0;
}

/** Credit clearing when commerce settles (idempotent per transaction). */
export async function recordClearingCreditFromCommerceSettlement(params: {
  businessId: string;
  transactionId: string;
  netUsd: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { businessId, transactionId, netUsd } = params;
  if (!Number.isFinite(netUsd) || netUsd <= 0) {
    return { ok: false, error: "Invalid net amount." };
  }
  const idempotencyKey = `clearing-settlement:${transactionId}`;
  const existing = await prisma.clearingLedgerEntry.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return { ok: true };

  const amount = toDecimal(netUsd);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.businessClearingAccount.upsert({
        where: { businessId },
        create: { businessId, balanceUsd: amount },
        update: { balanceUsd: { increment: amount } },
      });
      await tx.clearingLedgerEntry.create({
        data: {
          businessId,
          direction: "CREDIT",
          amountUsd: amount,
          reason: "SETTLEMENT_IN",
          idempotencyKey,
          metadata: { transactionId } as object,
        },
      });
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Debit clearing and credit gas prepaid (idempotent). */
export async function transferClearingToGasPrepaid(params: {
  businessId: string;
  amountUsd: number;
  idempotencyKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { businessId, amountUsd, idempotencyKey } = params;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return { ok: false, error: "Invalid amount." };
  }

  const gasKey = `gas-topup-clearing:${idempotencyKey}`;
  const existingGas = await prisma.gasLedgerEntry.findUnique({ where: { idempotencyKey: gasKey } });
  if (existingGas) return { ok: true };

  const clearingDebitKey = `clearing-gas-transfer:${idempotencyKey}`;
  const existingClearing = await prisma.clearingLedgerEntry.findUnique({
    where: { idempotencyKey: clearingDebitKey },
  });
  if (existingClearing) return { ok: true };

  const amount = toDecimal(amountUsd);

  try {
    await prisma.$transaction(async (tx) => {
      const acc = await tx.businessClearingAccount.findUnique({
        where: { businessId },
      });
      const bal = acc != null ? Number(acc.balanceUsd.toString()) : 0;
      if (bal < amountUsd) {
        throw new Error("INSUFFICIENT_CLEARING");
      }

      await tx.businessClearingAccount.update({
        where: { businessId },
        data: { balanceUsd: { decrement: amount } },
      });
      await tx.clearingLedgerEntry.create({
        data: {
          businessId,
          direction: "DEBIT",
          amountUsd: amount,
          reason: "GAS_TOPUP_TRANSFER",
          idempotencyKey: clearingDebitKey,
          metadata: { idempotencyKey } as object,
        },
      });

      await tx.businessGasAccount.upsert({
        where: { businessId },
        create: { businessId, prepaidBalanceUsd: amount },
        update: { prepaidBalanceUsd: { increment: amount } },
      });
      await tx.gasLedgerEntry.create({
        data: {
          businessId,
          direction: "CREDIT",
          amountUsd: amount,
          reason: "TOPUP",
          idempotencyKey: gasKey,
          metadata: { source: "CLEARING" } as object,
        },
      });
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INSUFFICIENT_CLEARING") {
      return { ok: false, error: "Insufficient Morapay balance for this amount." };
    }
    return { ok: false, error: msg };
  }
}

export async function getClearingBalanceUsd(businessId: string): Promise<string> {
  const row = await prisma.businessClearingAccount.findUnique({
    where: { businessId },
    select: { balanceUsd: true },
  });
  return row != null ? row.balanceUsd.toString() : "0";
}
