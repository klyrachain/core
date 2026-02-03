/**
 * Record balance before/after for a transaction (per asset). Audit trail so we can reason about
 * balances at each point in time when many transactions run concurrently.
 */

import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";

function toDecimal(v: Decimal | string | number): Decimal {
  if (v === undefined || v === null) return new Decimal(0);
  return typeof v === "object" ? new Decimal(v as Decimal) : new Decimal(v);
}

export async function recordBalanceSnapshot(
  transactionId: string,
  assetId: string,
  balanceBefore: Decimal | string | number,
  balanceAfter: Decimal | string | number
): Promise<void> {
  await prisma.transactionBalanceSnapshot.create({
    data: {
      transactionId,
      assetId,
      balanceBefore: toDecimal(balanceBefore),
      balanceAfter: toDecimal(balanceAfter),
    },
  });
}
