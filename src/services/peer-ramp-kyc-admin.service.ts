/**
 * Platform admin: list / reset / manual override for KYC (Peer Ramp app users + portal User rows).
 */

import { prisma } from "../lib/prisma.js";

function normEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type KycAdminSource = "peer_ramp" | "portal";

export type PeerRampKycAdminRow = {
  email: string;
  cliSessionId: string;
  kycStatus: string | null;
  kycProvider: string | null;
  kycVerifiedAt: string | null;
  profileCompletedAt: string | null;
  updatedAt: string;
  sessions: { provider: string; status: string; externalId: string; updatedAt: string }[];
  source: KycAdminSource;
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

  return users.map((user) => ({
    email: user.email,
    cliSessionId: user.cliSessionId,
    kycStatus: user.kycStatus,
    kycProvider: user.kycProvider,
    kycVerifiedAt: user.kycVerifiedAt?.toISOString() ?? null,
    profileCompletedAt: user.profileCompletedAt?.toISOString() ?? null,
    updatedAt: user.updatedAt.toISOString(),
    sessions: user.kycSessions.map((session) => ({
      provider: session.provider,
      status: session.status,
      externalId: session.externalId,
      updatedAt: session.updatedAt.toISOString(),
    })),
    source: "peer_ramp" as const,
  }));
}

function mapPortalUserToRow(user: {
  email: string;
  id: string;
  portalKycStatus: string | null;
  portalKycProvider: string | null;
  portalKycVerifiedAt: Date | null;
  updatedAt: Date;
}): PeerRampKycAdminRow {
  return {
    email: user.email,
    cliSessionId: user.id,
    kycStatus: user.portalKycStatus,
    kycProvider: user.portalKycProvider,
    kycVerifiedAt: user.portalKycVerifiedAt?.toISOString() ?? null,
    profileCompletedAt: null,
    updatedAt: user.updatedAt.toISOString(),
    sessions: [],
    source: "portal",
  };
}

/**
 * Peer Ramp app users plus portal `User` rows with person KYC fields set.
 * Dedupes by email (Peer Ramp row wins when both exist).
 */
export async function listAdminKycUsers(q: string | undefined, limit: number): Promise<PeerRampKycAdminRow[]> {
  const take = Math.min(Math.max(limit, 1), 200);
  const search = q?.trim();

  const [peerRampRows, portalCandidates] = await Promise.all([
    listPeerRampAppUsersForKycAdmin(search, take),
    prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [{ portalKycStatus: { not: null } }, { portalKycVerifiedAt: { not: null } }],
          },
          ...(search
            ? [{ email: { contains: search.toLowerCase(), mode: "insensitive" as const } }]
            : []),
        ],
      },
      take,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        email: true,
        portalKycStatus: true,
        portalKycProvider: true,
        portalKycVerifiedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const byEmail = new Map<string, PeerRampKycAdminRow>();
  for (const row of peerRampRows) {
    byEmail.set(normEmail(row.email), row);
  }
  for (const u of portalCandidates) {
    const key = normEmail(u.email);
    if (!byEmail.has(key)) {
      byEmail.set(key, mapPortalUserToRow(u));
    }
  }

  const merged = Array.from(byEmail.values());
  merged.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return merged.slice(0, take);
}

/** Clear KYC state so the user can start Didit/Persona again (Peer Ramp app or portal User). */
export async function resetPeerRampUserKyc(emailRaw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normEmail(emailRaw);
  if (!email.includes("@")) return { ok: false, error: "Invalid email" };

  const pr = await prisma.peerRampAppUser.findUnique({ where: { email }, select: { email: true } });
  if (pr) {
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

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    await prisma.user.update({
      where: { email },
      data: {
        portalKycStatus: null,
        portalKycProvider: null,
        portalKycVerifiedAt: null,
      },
    });
    return { ok: true };
  }

  return { ok: false, error: "User not found" };
}

/** Set KYC outcome in our DB only (does not call Didit). */
export async function overridePeerRampUserKyc(
  emailRaw: string,
  status: "approved" | "declined"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normEmail(emailRaw);
  if (!email.includes("@")) return { ok: false, error: "Invalid email" };

  const pr = await prisma.peerRampAppUser.findUnique({ where: { email }, select: { email: true } });
  if (pr) {
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

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    await prisma.user.update({
      where: { email },
      data: {
        portalKycStatus: status,
        portalKycProvider: "admin_manual",
        portalKycVerifiedAt: status === "approved" ? new Date() : null,
      },
    });
    return { ok: true };
  }

  return { ok: false, error: "User not found" };
}
