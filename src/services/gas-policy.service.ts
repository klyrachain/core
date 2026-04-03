import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";

const PLATFORM_ID = "default";

function toNum(v: Decimal | { toString(): string } | number): number {
  if (typeof v === "number") return v;
  return Number(v.toString());
}

/**
 * Sum of non-expired reservations for a business (funds held until tx completes).
 */
export async function sumActiveReservationsUsd(businessId: string): Promise<number> {
  const now = new Date();
  const agg = await prisma.gasReservation.aggregate({
    where: { businessId, expiresAt: { gt: now } },
    _sum: { amountUsd: true },
  });
  const raw = agg._sum.amountUsd;
  return raw != null ? toNum(raw) : 0;
}

export type GasPolicyPublic = {
  businessId: string;
  platformSponsorshipEnabled: boolean;
  businessSponsorshipEnabled: boolean;
  sufficientBalance: boolean;
  prepaidBalanceUsd: string;
  reservedUsd: string;
  availableUsd: string;
  maxUsdPerTx: string | null;
  effectiveSponsorship: boolean;
};

export async function buildGasPolicyPublic(businessId: string): Promise<GasPolicyPublic> {
  const [platform, account, reserved] = await Promise.all([
    prisma.platformGasSettings.findUnique({ where: { id: PLATFORM_ID } }),
    prisma.businessGasAccount.findUnique({ where: { businessId } }),
    sumActiveReservationsUsd(businessId),
  ]);

  const platformOn = platform?.sponsorshipEnabled ?? false;
  const maxUsdPerTx = platform?.maxUsdPerTx ?? null;

  const prepaid = account != null ? toNum(account.prepaidBalanceUsd) : 0;
  const businessToggle = account?.sponsorshipEnabled ?? false;
  const available = Math.max(0, prepaid - reserved);

  const sufficientBalance = available > 0;
  const businessSponsorshipEnabled = businessToggle && sufficientBalance;

  const platformHealthy = platformOn;
  const effectiveSponsorship =
    (platformHealthy && platformOn) || businessSponsorshipEnabled;

  return {
    businessId,
    platformSponsorshipEnabled: platformOn,
    businessSponsorshipEnabled,
    sufficientBalance,
    prepaidBalanceUsd: prepaid.toFixed(2),
    reservedUsd: reserved.toFixed(2),
    availableUsd: available.toFixed(2),
    maxUsdPerTx: maxUsdPerTx != null ? toNum(maxUsdPerTx).toFixed(2) : null,
    effectiveSponsorship,
  };
}
