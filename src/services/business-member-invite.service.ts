/**
 * Business team invites: create, list, revoke, accept (portal user must match invite email).
 */
import { randomBytes } from "node:crypto";
import type { BusinessRole } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { getEnv } from "../config/env.js";
import { sendEmail } from "./email.service.js";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function buildInviteUrl(token: string): string {
  const env = getEnv();
  const base = env.BUSINESS_SIGNUP_LANDING_URL?.trim()?.replace(/\/$/, "");
  if (base) {
    return `${base}/team/invite?token=${encodeURIComponent(token)}`;
  }
  return `(configure BUSINESS_SIGNUP_LANDING_URL) token=${token}`;
}

export async function canManageTeamMembers(
  businessId: string,
  userId: string | null,
  viaMerchantApiKey: boolean
): Promise<boolean> {
  if (viaMerchantApiKey) return true;
  if (!userId) return false;
  const m = await prisma.businessMember.findFirst({
    where: { businessId, userId, isActive: true },
    select: { role: true },
  });
  return m?.role === "OWNER" || m?.role === "ADMIN";
}

export async function listBusinessMembers(businessId: string) {
  const rows = await prisma.businessMember.findMany({
    where: { businessId, isActive: true },
    include: {
      user: { select: { id: true, email: true, portalDisplayName: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    email: r.user.email,
    displayName: r.user.portalDisplayName ?? undefined,
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
  }));
}

export async function listPendingInvites(businessId: string) {
  const rows = await prisma.businessMemberInvite.findMany({
    where: { businessId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createBusinessMemberInvite(opts: {
  businessId: string;
  email: string;
  role: BusinessRole;
  invitedByUserId: string | null;
}): Promise<{ id: string; inviteUrl: string }> {
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
  await sendEmail({
    to: normalized,
    subject: `You're invited to ${business?.name ?? "a team"} on Klyra`,
    html: `<p>You've been invited to join <strong>${business?.name ?? "a business"}</strong>.</p><p><a href="${inviteUrl}">Accept invitation</a></p><p>If the link does not work, open your dashboard and use the invite token from your administrator.</p>`,
    text: `You've been invited. Open: ${inviteUrl}`,
    entityRefId: invite.id,
  }).catch(() => {});
  return { id: invite.id, inviteUrl };
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
    const actor = await prisma.businessMember.findFirst({
      where: { businessId, userId: actorUserId!, isActive: true },
      select: { role: true },
    });
    if (actor?.role !== "OWNER" && actor?.role !== "ADMIN") {
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

  const existing = await prisma.businessMember.findFirst({
    where: { businessId: invite.businessId, userId, isActive: true },
  });
  if (existing) {
    await prisma.businessMemberInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    return { businessId: invite.businessId };
  }

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

  return { businessId: invite.businessId };
}
