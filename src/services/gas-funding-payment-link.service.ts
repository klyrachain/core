import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import type { MerchantEnvironment } from "../../prisma/generated/prisma/client.js";

function randomSlugPart(): string {
  return randomBytes(4).toString("hex");
}

function randomPublicCode(): string {
  return randomBytes(12).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
}

/**
 * One-time payment link for gas prepaid via crypto checkout (same payer UI as customer links).
 */
export async function createGasFundingPaymentLink(params: {
  businessId: string;
  environment: MerchantEnvironment;
  amountUsd: number;
  purpose: "GAS_TOPUP_FIAT" | "GAS_TOPUP_CRYPTO";
}): Promise<{ id: string; publicCode: string; slug: string }> {
  const { businessId, environment, amountUsd, purpose } = params;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Invalid amount.");
  }
  const slug = `gas-${params.businessId.slice(0, 8)}-${randomSlugPart()}`;
  let publicCode = randomPublicCode();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.paymentLink.findUnique({
      where: { publicCode },
      select: { id: true },
    });
    if (!clash) break;
    publicCode = randomPublicCode();
  }

  const row = await prisma.paymentLink.create({
    data: {
      businessId,
      environment,
      title: "Gas account top-up",
      description: "Prepaid gas for transaction sponsorship",
      slug,
      publicCode,
      type: "STANDARD",
      amount: amountUsd,
      currency: "USD",
      chargeKind: "FIAT",
      gasSponsorshipEnabled: false,
      isOneTime: true,
      isActive: true,
      metadata: { purpose } as object,
    },
  });
  return { id: row.id, publicCode: row.publicCode, slug: row.slug };
}
