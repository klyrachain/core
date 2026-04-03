/**
 * Background reconciliation: re-verify stale Paystack commerce charges so PENDING rows
 * become COMPLETED (via settleCommercePaystackTransaction) or FAILED when Paystack says so.
 */

import { prisma } from "../lib/prisma.js";
import { verifyTransaction, isPaystackConfigured } from "./paystack.service.js";
import { settleCommercePaystackTransaction } from "./commerce-paystack-settlement.service.js";

export type PaystackReconcileResult = {
  processed: number;
  settled: number;
  failedMarked: number;
  stillPending: number;
  skipped: number;
  errors: number;
};

function paystackStatusLower(data: { status: string }): string {
  return String(data.status ?? "").trim().toLowerCase();
}

/**
 * Re-verify pending commerce Paystack BUY rows and settle or mark failed.
 * Idempotent for success path (settlement handles already-COMPLETED).
 */
export async function reconcileStaleCommercePaystackTransactions(opts: {
  minAgeMs: number;
  maxBatch: number;
}): Promise<PaystackReconcileResult> {
  const out: PaystackReconcileResult = {
    processed: 0,
    settled: 0,
    failedMarked: 0,
    stillPending: 0,
    skipped: 0,
    errors: 0,
  };

  if (!isPaystackConfigured()) {
    return out;
  }

  const minDate = new Date(Date.now() - opts.minAgeMs);
  const rows = await prisma.transaction.findMany({
    where: {
      status: "PENDING",
      type: "BUY",
      paymentLinkId: { not: null },
      providerSessionId: { not: null },
      f_provider: "PAYSTACK",
      createdAt: { lt: minDate },
    },
    select: { id: true, providerSessionId: true },
    take: opts.maxBatch,
    orderBy: { createdAt: "asc" },
  });

  for (const row of rows) {
    const ref = row.providerSessionId?.trim();
    if (!ref) {
      out.skipped += 1;
      continue;
    }
    out.processed += 1;
    try {
      const data = await verifyTransaction(ref);
      const st = paystackStatusLower(data);

      if (st === "success") {
        const payerEmail =
          typeof data.metadata?.payer_email === "string"
            ? data.metadata.payer_email.trim()
            : null;
        const r = await settleCommercePaystackTransaction({
          transactionId: row.id,
          reference: ref,
          payerEmail,
        });
        if (r.updatedCount > 0) {
          out.settled += 1;
        } else if (r.notApplicable) {
          out.skipped += 1;
        } else {
          out.skipped += 1;
        }
      } else if (st === "failed" || st === "abandoned" || st === "reversed") {
        const u = await prisma.transaction.updateMany({
          where: {
            id: row.id,
            status: "PENDING",
            providerSessionId: ref,
          },
          data: { status: "FAILED" },
        });
        if (u.count > 0) {
          out.failedMarked += 1;
        } else {
          out.skipped += 1;
        }
      } else {
        out.stillPending += 1;
      }
    } catch {
      out.errors += 1;
    }
  }

  return out;
}
