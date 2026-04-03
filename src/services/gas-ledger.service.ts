import { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

function toDecimal(amount: number): InstanceType<typeof Prisma.Decimal> {
  return new Prisma.Decimal(amount.toFixed(8));
}

export type GasSponsorSource = "platform" | "business";

/**
 * Record a sponsorship debit when a sponsored tx completes.
 * Idempotent: same idempotencyKey returns existing without double-debit.
 */
export async function recordSponsorshipDebit(input: {
  businessId: string | null;
  amountUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  source: GasSponsorSource;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  if (input.amountUsd <= 0 || !Number.isFinite(input.amountUsd)) {
    return { ok: false, error: "Invalid amount." };
  }

  const existing = await prisma.gasLedgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return { ok: true, entryId: existing.id };
  }

  const amount = toDecimal(input.amountUsd);

  try {
    const entryId = await prisma.$transaction(async (tx) => {
      if (input.source === "business") {
        const bid = input.businessId;
        if (!bid) {
          throw new Error("MISSING_BUSINESS");
        }
        const acc = await tx.businessGasAccount.findUnique({
          where: { businessId: bid },
        });
        if (!acc) {
          throw new Error("NO_ACCOUNT");
        }
        const balance = Number(acc.prepaidBalanceUsd.toString());
        if (balance < input.amountUsd) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        await tx.businessGasAccount.update({
          where: { businessId: bid },
          data: { prepaidBalanceUsd: { decrement: amount } },
        });
      }

      const row = await tx.gasLedgerEntry.create({
        data: {
          businessId: input.source === "platform" ? null : input.businessId,
          direction: "DEBIT",
          amountUsd: amount,
          reason: "SPONSORSHIP",
          idempotencyKey: input.idempotencyKey,
          metadata: (input.metadata ?? {}) as object,
        },
      });
      return row.id;
    });

    return { ok: true, entryId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "MISSING_BUSINESS") return { ok: false, error: "Business id required for business-sponsored debit." };
    if (msg === "NO_ACCOUNT") return { ok: false, error: "Business gas account not found." };
    if (msg === "INSUFFICIENT_BALANCE") return { ok: false, error: "Insufficient prepaid balance." };
    throw e;
  }
}

/**
 * Credit a business gas account (e.g. top-up). Idempotent by idempotency key.
 */
export async function recordGasCredit(input: {
  businessId: string;
  amountUsd: number;
  idempotencyKey: string;
  reason: "TOPUP" | "ADJUSTMENT" | "REFUND";
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  if (input.amountUsd <= 0 || !Number.isFinite(input.amountUsd)) {
    return { ok: false, error: "Invalid amount." };
  }

  const existing = await prisma.gasLedgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return { ok: true, entryId: existing.id };
  }

  const amount = toDecimal(input.amountUsd);

  const entryId = await prisma.$transaction(async (tx) => {
    await tx.businessGasAccount.upsert({
      where: { businessId: input.businessId },
      create: {
        businessId: input.businessId,
        prepaidBalanceUsd: amount,
      },
      update: {
        prepaidBalanceUsd: { increment: amount },
      },
    });

    const row = await tx.gasLedgerEntry.create({
      data: {
        businessId: input.businessId,
        direction: "CREDIT",
        amountUsd: amount,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        metadata: (input.metadata ?? {}) as object,
      },
    });
    return row.id;
  });

  return { ok: true, entryId };
}
