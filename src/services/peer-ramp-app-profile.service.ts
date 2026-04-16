/**
 * Peer-ramp web app: profile / payout hints for offramp settlement.
 */

import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyPeerRampAppSessionToken } from "./peer-ramp-app-auth.service.js";
import { isPaystackConfigured, resolveBankAccount } from "./paystack.service.js";

const ProfileBodySchema = z.object({
  phone: z.string().min(5).max(24),
  countryCode: z.string().length(2),
  paystackCountrySlug: z.string().min(2).max(32),
  payoutMethod: z.enum(["bank", "mobile_money"]),
  payoutDetails: z.record(z.string(), z.unknown()).optional(),
});

export type PeerRampAppProfileInput = z.infer<typeof ProfileBodySchema>;

export function parsePeerRampProfileBody(body: unknown):
  | { ok: true; data: PeerRampAppProfileInput }
  | { ok: false; error: string } {
  const parse = ProfileBodySchema.safeParse(body && typeof body === "object" ? body : {});
  if (!parse.success) {
    return { ok: false, error: "Validation failed" };
  }
  return { ok: true, data: parse.data };
}

export async function getPeerRampAppLookup(emailRaw: string): Promise<{
  exists: boolean;
  profileComplete: boolean;
}> {
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) {
    return { exists: false, profileComplete: false };
  }
  const user = await prisma.peerRampAppUser.findUnique({
    where: { email },
    select: {
      phone: true,
      paystackCountrySlug: true,
      payoutMethod: true,
      profileCompletedAt: true,
    },
  });
  if (!user) {
    return { exists: false, profileComplete: false };
  }
  const profileComplete = !!(
    user.profileCompletedAt &&
    user.phone?.trim() &&
    user.paystackCountrySlug?.trim() &&
    user.payoutMethod
  );
  return { exists: true, profileComplete };
}

export async function getPeerRampAppMe(email: string) {
  const user = await prisma.peerRampAppUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) return null;
  return {
    email: user.email,
    cliSessionId: user.cliSessionId,
    phone: user.phone,
    countryCode: user.countryCode,
    paystackCountrySlug: user.paystackCountrySlug,
    payoutMethod: user.payoutMethod,
    payoutDetails: user.payoutDetails,
    profileCompletedAt: user.profileCompletedAt?.toISOString() ?? null,
  };
}

/**
 * Best-effort Paystack resolve for bank / mobile-money account name.
 * On failure we still save the profile; client can show partial payout details.
 */
async function mergeResolvedAccountName(
  input: PeerRampAppProfileInput
): Promise<Record<string, unknown>> {
  const raw = (input.payoutDetails ?? {}) as Record<string, unknown>;
  if (!isPaystackConfigured()) return raw;

  try {
    if (input.payoutMethod === "bank") {
      const bankCode = String(raw.bankCode ?? "").trim();
      const accountNumber = String(raw.accountNumber ?? "").replace(/\D/g, "");
      if (!bankCode || accountNumber.length < 6) return raw;
      const r = await resolveBankAccount(accountNumber, bankCode);
      const name = r.account_name?.trim();
      if (name) return { ...raw, accountName: name };
      return raw;
    }
    if (input.payoutMethod === "mobile_money") {
      const bankCode = String(raw.providerCode ?? "").trim();
      const accountNumber = String(raw.phone ?? "").replace(/\D/g, "");
      if (!bankCode || accountNumber.length < 6) return raw;
      const r = await resolveBankAccount(accountNumber, bankCode);
      const name = r.account_name?.trim();
      if (name) return { ...raw, accountName: name };
      return raw;
    }
  } catch (e) {
    console.warn("[peer-ramp-app] payout name resolve failed (profile still saved)", e);
  }
  return raw;
}

export async function updatePeerRampAppProfile(
  email: string,
  input: PeerRampAppProfileInput
): Promise<void> {
  const payoutDetails = await mergeResolvedAccountName(input);
  await prisma.peerRampAppUser.update({
    where: { email: email.trim().toLowerCase() },
    data: {
      phone: input.phone.trim(),
      countryCode: input.countryCode.trim().toUpperCase(),
      paystackCountrySlug: input.paystackCountrySlug.trim().toLowerCase(),
      payoutMethod: input.payoutMethod,
      payoutDetails: payoutDetails as object,
      profileCompletedAt: new Date(),
    },
  });
}

export function sessionFromBearer(bearer: string | undefined): { email: string; cliSessionId: string } | null {
  if (!bearer?.trim()) return null;
  return verifyPeerRampAppSessionToken(bearer.trim());
}
