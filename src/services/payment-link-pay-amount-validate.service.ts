import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { paymentLinkAmountIsOpen } from "../lib/payment-link-amount-open.js";

/**
 * When creating a payer-side transaction for a commerce PaymentLink, load the link from
 * the DB and reject tampered amounts for fixed-price links.
 */
export async function validatePayerAmountAgainstPaymentLink(opts: {
  paymentLinkId: string;
  clientAmount: string;
  clientCurrency: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.paymentLink.findFirst({
    where: { id: opts.paymentLinkId.trim(), isActive: true },
    select: { amount: true, currency: true },
  });
  if (!row) {
    return { ok: false, error: "Payment link not found." };
  }
  if (paymentLinkAmountIsOpen(row.amount)) {
    return { ok: true };
  }
  const canonical = row.amount;
  if (canonical == null) {
    return { ok: false, error: "Invalid payment link amount." };
  }
  const curClient = opts.clientCurrency.trim().toUpperCase();
  const curRow = row.currency.trim().toUpperCase();
  if (curClient !== curRow) {
    return { ok: false, error: "Currency does not match this payment link." };
  }
  try {
    if (!new Decimal(opts.clientAmount).eq(new Decimal(canonical))) {
      return { ok: false, error: "Amount does not match this payment link." };
    }
  } catch {
    return { ok: false, error: "Invalid amount." };
  }
  return { ok: true };
}
