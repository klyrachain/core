import { Decimal } from "@prisma/client/runtime/client";

/** True when the link has no fixed charge amount (open / pay-what-you-want). */
export function paymentLinkAmountIsOpen(amt: Decimal | null): boolean {
  if (amt == null) return true;
  try {
    return new Decimal(amt).lte(0);
  } catch {
    return true;
  }
}
