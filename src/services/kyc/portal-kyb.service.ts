/**
 * Business portal KYB (`Business.kyb*`) — Didit KYB workflow only.
 * `vendor_data` on the Didit session is the **business id** (UUID) so webhooks and decision sync can scope updates.
 */

import { KybStatus } from "../../../prisma/generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../config/env.js";
import {
  createDiditSession,
  fetchDiditSessionDecision,
  mapDiditStatus,
} from "./didit.service.js";
import type { KycInitResult } from "./kyc.types.js";

const TERMINAL_KYB = new Set<KybStatus>([KybStatus.APPROVED, KybStatus.REJECTED]);

export type PortalKybStatusResult = {
  kybStatus: KybStatus;
};

function mapDiditNormalisedToKybStatus(normalised: string): KybStatus {
  if (normalised === "approved") return KybStatus.APPROVED;
  if (normalised === "declined") return KybStatus.REJECTED;
  return KybStatus.PENDING;
}

export async function initPortalBusinessKybSession(
  businessId: string,
  correlationEmail: string,
  callbackUrl: string
): Promise<KycInitResult> {
  const emailNorm = correlationEmail.trim().toLowerCase();
  const result = await createDiditSession(emailNorm, callbackUrl, {
    workflowKind: "kyb",
    vendorData: businessId,
  });

  await prisma.business.update({
    where: { id: businessId },
    data: {
      kybDiditSessionId: result.externalId,
      kybStatus: KybStatus.PENDING,
    },
  });

  return result;
}

export async function getPortalBusinessKybStatus(businessId: string): Promise<PortalKybStatusResult | null> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: { kybStatus: true },
  });
  if (!row) return null;
  return { kybStatus: row.kybStatus };
}

async function applyBusinessKybFromDidit(
  businessId: string,
  sessionId: string,
  normalised: string
): Promise<void> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { kybStatus: true },
  });
  if (!b) return;
  if (b.kybStatus && TERMINAL_KYB.has(b.kybStatus)) {
    return;
  }
  const next = mapDiditNormalisedToKybStatus(normalised);
  await prisma.business.update({
    where: { id: businessId },
    data: {
      kybDiditSessionId: sessionId,
      kybStatus: next,
    },
  });
}

export async function syncPortalBusinessKybFromDecisionApi(
  businessId: string,
  verificationSessionId?: string | null
): Promise<
  | { ok: true; kyb: PortalKybStatusResult }
  | { ok: false; error: string; code: string }
> {
  let sessionId = verificationSessionId?.trim() ?? "";
  if (!sessionId) {
    const row = await prisma.business.findUnique({
      where: { id: businessId },
      select: { kybDiditSessionId: true },
    });
    sessionId = row?.kybDiditSessionId?.trim() ?? "";
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
  if (vendorData !== businessId) {
    return { ok: false, error: "Session does not belong to this business.", code: "SESSION_MISMATCH" };
  }

  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: { kybDiditSessionId: true },
  });
  if (row?.kybDiditSessionId !== sessionId) {
    return { ok: false, error: "Session does not match your verification.", code: "SESSION_MISMATCH" };
  }

  const rawStatus = String(decision.status ?? "").trim();
  if (!rawStatus) {
    return { ok: false, error: "Didit returned no status for this session.", code: "NO_STATUS" };
  }

  const normalised = mapDiditStatus(rawStatus);
  await applyBusinessKybFromDidit(businessId, sessionId, normalised);
  const kyb = await getPortalBusinessKybStatus(businessId);
  if (!kyb) {
    return { ok: false, error: "Business not found.", code: "NOT_FOUND" };
  }
  return { ok: true, kyb };
}

/** Didit webhook: vendor_data is business UUID. */
export async function upsertBusinessKybFromDiditWebhook(
  businessId: string,
  sessionId: string,
  normalisedStatus: string,
  _rawStatus: string,
  _rawPayload: unknown
): Promise<void> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { kybStatus: true },
  });
  if (!b) return;
  if (b.kybStatus && TERMINAL_KYB.has(b.kybStatus)) {
    return;
  }
  await applyBusinessKybFromDidit(businessId, sessionId, normalisedStatus);
}

export function resolvePortalKybCallbackUrl(bodyCallback: string | undefined): string {
  const trimmed = bodyCallback?.trim() ?? "";
  if (trimmed && /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const env = getEnv();
  const base = (env.MERCHANT_DASHBOARD_URL ?? env.FRONTEND_APP_URL).replace(/\/+$/, "");
  return `${base}/settings/kyc?flow=kyb`;
}
