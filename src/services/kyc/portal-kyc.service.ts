/**
 * Business-portal member KYC (`User.portalKyc*`) — Didit only.
 * Distinct from Peer Ramp consumer KYC (`PeerRampAppUser` + kyc-router peer-ramp paths).
 */

import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../config/env.js";
import {
  createDiditSession,
  fetchDiditSessionDecision,
  mapDiditStatus,
} from "./didit.service.js";
import type { KycInitResult } from "./kyc.types.js";

const TERMINAL_STATUSES = new Set(["approved", "declined"]);

export type PortalKycStatusResult = {
  portalKycStatus: string | null;
  portalKycVerifiedAt: Date | null;
  portalKycProvider: string | null;
};

export async function initPortalMemberKycSession(
  userId: string,
  email: string,
  callbackUrl: string
): Promise<KycInitResult> {
  const result = await createDiditSession(email.trim().toLowerCase(), callbackUrl, {
    workflowKind: "portal_kyc",
  });

  await prisma.user.update({
    where: { id: userId },
    data: { portalKycDiditSessionId: result.externalId },
  });

  return result;
}

export async function getPortalMemberKycStatus(userId: string): Promise<PortalKycStatusResult> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      portalKycStatus: true,
      portalKycVerifiedAt: true,
      portalKycProvider: true,
    },
  });
  return {
    portalKycStatus: row?.portalKycStatus ?? null,
    portalKycVerifiedAt: row?.portalKycVerifiedAt ?? null,
    portalKycProvider: row?.portalKycProvider ?? null,
  };
}

/**
 * Poll Didit decision API and update `User` portal KYC fields (mirrors peer-ramp sync for ramp users).
 */
export async function syncPortalDiditFromDecisionApi(
  userId: string,
  email: string,
  verificationSessionId?: string | null
): Promise<
  | { ok: true; kyc: PortalKycStatusResult }
  | { ok: false; error: string; code: string }
> {
  const emailNorm = email.trim().toLowerCase();
  let sessionId = verificationSessionId?.trim() ?? "";
  if (!sessionId) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { portalKycDiditSessionId: true },
    });
    sessionId = row?.portalKycDiditSessionId?.trim() ?? "";
  }
  if (!sessionId) {
    return { ok: false, error: "No Didit verification session found to check.", code: "NO_DIDIT_SESSION" };
  }

  let decision: Record<string, unknown>;
  try {
    decision = await fetchDiditSessionDecision(sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not reach Didit.";
    return { ok: false, error: msg, code: "DIDIT_FETCH_FAILED" };
  }

  const vendorData = String(decision.vendor_data ?? "").trim();
  if (vendorData.includes("@")) {
    if (vendorData.toLowerCase() !== emailNorm) {
      return { ok: false, error: "Session does not belong to this account.", code: "SESSION_MISMATCH" };
    }
  } else {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { portalKycDiditSessionId: true },
    });
    if (row?.portalKycDiditSessionId !== sessionId) {
      return { ok: false, error: "Session does not match your verification.", code: "SESSION_MISMATCH" };
    }
  }

  const rawStatus = String(decision.status ?? "").trim();
  if (!rawStatus) {
    return { ok: false, error: "Didit returned no status for this session.", code: "NO_STATUS" };
  }

  const normalised = mapDiditStatus(rawStatus);
  await applyPortalKycDecision(userId, sessionId, normalised, rawStatus);
  const kyc = await getPortalMemberKycStatus(userId);
  return { ok: true, kyc };
}

async function applyPortalKycDecision(
  userId: string,
  sessionId: string,
  normalisedStatus: string,
  _rawStatus: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { portalKycStatus: true },
  });

  if (user?.portalKycStatus && TERMINAL_STATUSES.has(user.portalKycStatus)) {
    return;
  }

  const isTerminal = TERMINAL_STATUSES.has(normalisedStatus);
  await prisma.user.update({
    where: { id: userId },
    data: {
      portalKycDiditSessionId: sessionId,
      portalKycStatus: normalisedStatus,
      portalKycProvider: "didit",
      portalKycVerifiedAt: isTerminal ? new Date() : null,
    },
  });
}

/**
 * Didit webhook path: update portal User when the email is not a Peer Ramp consumer.
 */
export async function upsertPortalUserFromDiditWebhook(
  email: string,
  sessionId: string,
  normalisedStatus: string,
  _rawStatus: string,
  _rawPayload: unknown
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, portalKycStatus: true },
  });
  if (!user) return;

  if (user.portalKycStatus && TERMINAL_STATUSES.has(user.portalKycStatus)) {
    return;
  }

  const isTerminal = TERMINAL_STATUSES.has(normalisedStatus);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      portalKycDiditSessionId: sessionId,
      portalKycStatus: normalisedStatus,
      portalKycProvider: "didit",
      portalKycVerifiedAt: isTerminal ? new Date() : null,
    },
  });
}

/** Resolve callback URL for Didit redirect after portal KYC. */
export function resolvePortalKycCallbackUrl(bodyCallback: string | undefined): string {
  const trimmed = bodyCallback?.trim() ?? "";
  if (trimmed && /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const env = getEnv();
  const base = (env.MERCHANT_DASHBOARD_URL ?? env.FRONTEND_APP_URL).replace(/\/+$/, "");
  return `${base}/settings/kyc`;
}
