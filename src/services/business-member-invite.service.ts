/**
 * Business team invites: create, list, revoke, accept (portal user must match invite email).
 */
import { randomBytes } from "node:crypto";
import { Prisma, type BusinessRole } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { getEnv } from "../config/env.js";
import { sendEmail } from "./email.service.js";
import {
  businessTeamInviteHtml,
  businessTeamInviteSubject,
  businessTeamInviteText,
} from "../email/templates/business-team-invite.js";

/** Invites expire after this window; link becomes unusable and a new invite must be sent. */
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

function buildInviteUrl(token: string): string {
  const env = getEnv();
  const base = env.BUSINESS_SIGNUP_LANDING_URL?.trim()?.replace(/\/$/, "");
  if (base) {
    return `${base}/team/invite?token=${encodeURIComponent(token)}`;
  }
  return `(configure BUSINESS_SIGNUP_LANDING_URL) token=${token}`;
}

/**
 * Portal users who may manage invites and membership (without platform API key).
 * OWNER/ADMIN always; also the **earliest active join** on the business so the Morapay creator
 * keeps team powers if their row is still DEVELOPER/FINANCE/etc. from older signup mapping.
 */
async function isBusinessTeamManager(businessId: string, userId: string): Promise<boolean> {
  const m = await prisma.businessMember.findFirst({
    where: { businessId, userId, isActive: true },
    select: { role: true },
  });
  if (!m) return false;
  if (m.role === "OWNER" || m.role === "ADMIN") return true;
  const first = await prisma.businessMember.findFirst({
    where: { businessId, isActive: true },
    orderBy: { joinedAt: "asc" },
    select: { userId: true },
  });
  return first?.userId === userId;
}

export async function canManageTeamMembers(
  businessId: string,
  userId: string | null,
  viaMerchantApiKey: boolean
): Promise<boolean> {
  if (viaMerchantApiKey) return true;
  if (!userId) return false;
  return isBusinessTeamManager(businessId, userId);
}

export async function listBusinessMembers(businessId: string) {
  const rows = await prisma.businessMember.findMany({
    where: { businessId, isActive: true },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          portalDisplayName: true,
          portalKycStatus: true,
          portalKycVerifiedAt: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((memberRow) => ({
    id: memberRow.id,
    userId: memberRow.userId,
    email: memberRow.user.email,
    displayName: memberRow.user.portalDisplayName ?? undefined,
    role: memberRow.role,
    joinedAt: memberRow.joinedAt.toISOString(),
    portalKycStatus: memberRow.user.portalKycStatus ?? undefined,
    portalKycVerifiedAt: memberRow.user.portalKycVerifiedAt?.toISOString() ?? undefined,
  }));
}

export async function listPendingInvites(businessId: string) {
  const rows = await prisma.businessMemberInvite.findMany({
    where: { businessId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((inviteRow) => ({
    id: inviteRow.id,
    email: inviteRow.email,
    role: inviteRow.role,
    expiresAt: inviteRow.expiresAt.toISOString(),
    createdAt: inviteRow.createdAt.toISOString(),
  }));
}

export async function createBusinessMemberInvite(opts: {
  businessId: string;
  email: string;
  role: BusinessRole;
  invitedByUserId: string | null;
}): Promise<{ id: string; inviteUrl: string; expiresAt: string }> {
  const normalized = opts.email.trim().toLowerCase();
  const existing = await prisma.businessMember.findFirst({
    where: { businessId: opts.businessId, user: { email: normalized }, isActive: true },
  });
  if (existing) {
    throw new Error("User is already a member of this business.");
  }
  const pending = await prisma.businessMemberInvite.findFirst({
    where: {
      businessId: opts.businessId,
      email: normalized,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (pending) {
    throw new Error("An active invite already exists for this email.");
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = await prisma.businessMemberInvite.create({
    data: {
      businessId: opts.businessId,
      email: normalized,
      role: opts.role,
      token,
      expiresAt,
      invitedByUserId: opts.invitedByUserId ?? undefined,
    },
  });
  const inviteUrl = buildInviteUrl(token);
  const business = await prisma.business.findUnique({
    where: { id: opts.businessId },
    select: { name: true },
  });
  const businessName = business?.name ?? "a team";
  const expiresAtIso = invite.expiresAt.toISOString();
  const templateVars = {
    businessName,
    inviteUrl,
    roleLabel: opts.role,
    expiresAtDisplay: invite.expiresAt.toUTCString(),
  };
  await sendEmail({
    to: normalized,
    subject: businessTeamInviteSubject(templateVars),
    html: businessTeamInviteHtml(templateVars),
    text: businessTeamInviteText(templateVars),
    entityRefId: invite.id,
    fromPersona: "business",
  }).catch(() => {});
  return { id: invite.id, inviteUrl, expiresAt: expiresAtIso };
}

/** Revoke a pending invite and issue a fresh link + email (same email/role). */
export async function resendBusinessMemberInvite(opts: {
  businessId: string;
  inviteId: string;
  invitedByUserId: string | null;
}): Promise<{ id: string; inviteUrl: string; expiresAt: string }> {
  const row = await prisma.businessMemberInvite.findFirst({
    where: { id: opts.inviteId, businessId: opts.businessId, acceptedAt: null },
  });
  if (!row) throw new Error("Invite not found.");
  await prisma.businessMemberInvite.delete({ where: { id: row.id } });
  return createBusinessMemberInvite({
    businessId: opts.businessId,
    email: row.email,
    role: row.role,
    invitedByUserId: opts.invitedByUserId,
  });
}

export async function deactivateBusinessMember(
  businessId: string,
  memberId: string,
  actorUserId: string | null,
  viaMerchantApiKey: boolean
): Promise<void> {
  if (!viaMerchantApiKey) {
    if (!actorUserId) throw new Error("Forbidden.");
    if (!(await isBusinessTeamManager(businessId, actorUserId))) {
      throw new Error("Only owners and admins can remove members.");
    }
  }
  const target = await prisma.businessMember.findFirst({
    where: { id: memberId, businessId, isActive: true },
    select: { role: true, userId: true },
  });
  if (!target) throw new Error("Member not found.");
  if (target.role === "OWNER") {
    throw new Error("The business owner cannot be removed here.");
  }
  if (!viaMerchantApiKey && target.userId === actorUserId) {
    throw new Error("You cannot remove your own membership while signed in.");
  }
  await prisma.businessMember.update({
    where: { id: memberId },
    data: { isActive: false },
  });
}

export async function revokeBusinessMemberInvite(businessId: string, inviteId: string): Promise<boolean> {
  const row = await prisma.businessMemberInvite.findFirst({
    where: { id: inviteId, businessId, acceptedAt: null },
  });
  if (!row) return false;
  await prisma.businessMemberInvite.delete({ where: { id: inviteId } });
  return true;
}

export async function updateMemberRole(
  businessId: string,
  memberId: string,
  newRole: BusinessRole,
  actorUserId: string | null,
  viaMerchantApiKey: boolean
): Promise<void> {
  if (!viaMerchantApiKey) {
    if (!actorUserId) throw new Error("Forbidden.");
    if (!(await isBusinessTeamManager(businessId, actorUserId))) {
      throw new Error("Only owners and admins can change roles.");
    }
  }
  const target = await prisma.businessMember.findFirst({
    where: { id: memberId, businessId, isActive: true },
    select: { role: true },
  });
  if (!target) throw new Error("Member not found.");
  if (newRole === "OWNER") {
    throw new Error("Cannot assign owner role via API.");
  }
  if (target.role === "OWNER") {
    throw new Error("Cannot change the business owner's role via API.");
  }
  await prisma.businessMember.update({
    where: { id: memberId },
    data: { role: newRole },
  });
}

export async function acceptBusinessMemberInvite(token: string, userId: string): Promise<{ businessId: string }> {
  const invite = await prisma.businessMemberInvite.findUnique({
    where: { token },
    include: { business: { select: { id: true, name: true } } },
  });
  if (!invite) throw new Error("Invalid invite.");
  if (invite.acceptedAt) throw new Error("Invite already used.");
  if (invite.expiresAt.getTime() < Date.now()) throw new Error("Invite expired.");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new Error("User not found.");
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new Error("Sign in with the email address this invite was sent to.");
  }

  const memberKey = { userId, businessId: invite.businessId };
  const existingRow = await prisma.businessMember.findUnique({
    where: { userId_businessId: memberKey },
  });

  if (existingRow) {
    const preserveOwnerRole = existingRow.role === "OWNER";
    await prisma.$transaction(async (tx) => {
      await tx.businessMember.update({
        where: { id: existingRow.id },
        data: {
          isActive: true,
          ...(preserveOwnerRole ? {} : { role: invite.role }),
        },
      });
      await tx.businessMemberInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });
    return { businessId: invite.businessId };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.businessMember.create({
        data: {
          userId,
          businessId: invite.businessId,
          role: invite.role,
          isActive: true,
        },
      });
      await tx.businessMemberInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.businessMember.findUnique({
        where: { userId_businessId: memberKey },
      });
      if (!again) throw e;
      const preserveOwnerRole = again.role === "OWNER";
      await prisma.$transaction(async (tx) => {
        await tx.businessMember.update({
          where: { id: again.id },
          data: {
            isActive: true,
            ...(preserveOwnerRole ? {} : { role: invite.role }),
          },
        });
        await tx.businessMemberInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
      });
    } else {
      throw e;
    }
  }

  return { businessId: invite.businessId };
}
