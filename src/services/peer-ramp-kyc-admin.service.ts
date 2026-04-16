/**
 * Platform admin: list / reset / manual override for Peer Ramp app KYC (Didit/Persona + DB).
 */

import { prisma } from "../lib/prisma.js";

function normEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type PeerRampKycAdminRow = {
  email: string;
  cliSessionId: string;
  kycStatus: string | null;
  kycProvider: string | null;
  kycVerifiedAt: string | null;
  profileCompletedAt: string | null;
  updatedAt: string;
  sessions: { provider: string; status: string; externalId: string; updatedAt: string }[];
};

export async function listPeerRampAppUsersForKycAdmin(
  q: string | undefined,
  limit: number
): Promise<PeerRampKycAdminRow[]> {
  const take = Math.min(Math.max(limit, 1), 200);
  const search = q?.trim();
  const users = await prisma.peerRampAppUser.findMany({
    where: search
      ? {
          email: { contains: search.toLowerCase(), mode: "insensitive" },
        }
      : undefined,
    take,
    orderBy: { updatedAt: "desc" },
    select: {
      email: true,
      cliSessionId: true,
      kycStatus: true,
      kycProvider: true,
      kycVerifiedAt: true,
      profileCompletedAt: true,
      updatedAt: true,
      kycSessions: {
        select: {
          provider: true,
          status: true,
          externalId: true,
          updatedAt: true,
        },
      },
    },
  });

  return users.map((u) => ({
    email: u.email,
    cliSessionId: u.cliSessionId,
    kycStatus: u.kycStatus,
    kycProvider: u.kycProvider,
    kycVerifiedAt: u.kycVerifiedAt?.toISOString() ?? null,
    profileCompletedAt: u.profileCompletedAt?.toISOString() ?? null,
    updatedAt: u.updatedAt.toISOString(),
    sessions: u.kycSessions.map((s) => ({
      provider: s.provider,
      status: s.status,
      externalId: s.externalId,
      updatedAt: s.updatedAt.toISOString(),
    })),
  }));
}

/** Clear KYC state and provider sessions so the user can start Didit/Persona again. */
export async function resetPeerRampUserKyc(emailRaw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normEmail(emailRaw);
  if (!email.includes("@")) return { ok: false, error: "Invalid email" };

  const exists = await prisma.peerRampAppUser.findUnique({ where: { email }, select: { email: true } });
  if (!exists) return { ok: false, error: "User not found" };

  await prisma.$transaction([
    prisma.peerRampKycSession.deleteMany({ where: { email } }),
    prisma.peerRampAppUser.update({
      where: { email },
      data: {
        kycStatus: null,
        kycProvider: null,
        kycVerifiedAt: null,
      },
    }),
  ]);

  return { ok: true };
}

/** Set KYC outcome in our DB only (does not call Didit). For ops / compliance overrides. */
export async function overridePeerRampUserKyc(
  emailRaw: string,
  status: "approved" | "declined"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normEmail(emailRaw);
  if (!email.includes("@")) return { ok: false, error: "Invalid email" };

  const exists = await prisma.peerRampAppUser.findUnique({ where: { email }, select: { email: true } });
  if (!exists) return { ok: false, error: "User not found" };

  await prisma.peerRampAppUser.update({
    where: { email },
    data: {
      kycStatus: status,
      kycProvider: "admin_manual",
      kycVerifiedAt: status === "approved" ? new Date() : null,
    },
  });

  return { ok: true };
}
