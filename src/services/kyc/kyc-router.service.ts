/**
 * KYC router: maps opaque service IDs to providers, orchestrates session creation,
 * status queries, and webhook processing.
 *
 * **Scope:** Peer Ramp **consumer** identity only — persists to `PeerRampAppUser` / `PeerRampKycSession`.
 * Business-portal merchant / invited-member KYC (`User.portalKyc*`) is a separate product path, not these writes.
 *
 * The HTTP caller only passes opaque service IDs; provider names stay inside this module.
 */

import { getEnv } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import type {
  KycInitResult,
  KycStatusResult,
  KycProvider,
  DiditWebhookPayload,
} from "./kyc.types.js";

export type SyncDiditKycResult =
  | { ok: true; kyc: KycStatusResult }
  | { ok: false; error: string; code: string };
import {
  createDiditSession,
  mapDiditStatus,
  verifyDiditWebhookSignature,
  parseDiditWebhook,
  fetchDiditSessionDecision,
} from "./didit.service.js";
import { upsertPortalUserFromDiditWebhook } from "./portal-kyc.service.js";
import {
  createOrResumePersonaInquiry,
  mapPersonaStatus,
  verifyPersonaWebhookSignature,
  parsePersonaWebhook,
  getPersonaWebhookEmail,
  getPersonaWebhookInquiryId,
  getPersonaWebhookStatus,
} from "./persona.service.js";

/** Terminal KYC statuses — once set, not downgraded by subsequent webhooks. */
const TERMINAL_STATUSES = new Set(["approved", "declined"]);

/**
 * Parse KYC_SERVICE_MAP from env. Supports:
 * - Standard JSON: {"id1":"didit","id2":"persona"}
 * - Same with outer single quotes or stray BOM/newlines (common .env issues)
 * - Fallback: id:provider,id2:provider2 (comma-separated, values must be didit|persona)
 */
function parseKycServiceMapEnv(raw: string): Record<string, string> {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1).trim();
  }
  // .env often stores JSON as {\"k\":\"v\"} (literal backslash-quote) — invalid for JSON.parse
  if (s.includes('\\"')) {
    s = s.replace(/\\"/g, '"');
  }
  try {
    const parsed = JSON.parse(s) as Record<string, string>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    /* try fallback */
  }
  // Fallback: opaqueId:didit,opaqueId2:persona
  const out: Record<string, string> = {};
  for (const part of s.split(",")) {
    const seg = part.trim();
    const colon = seg.indexOf(":");
    if (colon <= 0) continue;
    const id = seg.slice(0, colon).trim();
    const provider = seg.slice(colon + 1).trim();
    if (id && (provider === "didit" || provider === "persona")) {
      out[id] = provider;
    }
  }
  if (Object.keys(out).length > 0) return out;

  const preview = s.length > 120 ? `${s.slice(0, 120)}…` : s;
  throw new Error(
    `KYC_SERVICE_MAP is not valid JSON or id:provider list. First chars: ${JSON.stringify(preview)}`
  );
}

/**
 * Resolve an opaque service ID (e.g. "svc_kyc_01") to a provider name.
 * The mapping lives exclusively in KYC_SERVICE_MAP (Core env, never exposed).
 */
export function resolveKycProvider(serviceId: string): KycProvider {
  const raw = getEnv().KYC_SERVICE_MAP;
  if (!raw?.trim()) {
    throw new Error(
      "KYC_SERVICE_MAP is not configured. Cannot resolve KYC provider."
    );
  }
  const map = parseKycServiceMapEnv(raw);
  const provider = map[serviceId];
  if (!provider) {
    throw new Error(`KYC service ID '${serviceId}' not found in KYC_SERVICE_MAP.`);
  }
  if (provider !== "didit" && provider !== "persona") {
    throw new Error(`Unknown KYC provider '${provider}' in KYC_SERVICE_MAP.`);
  }
  return provider as KycProvider;
}

/**
 * Initialise (or resume) a **Peer Ramp consumer** KYC session (email = `PeerRampAppUser`).
 * Upserts `PeerRampKycSession` and returns provider-specific init data.
 */
export async function initKycSession(
  email: string,
  serviceId: string,
  callbackUrl: string
): Promise<KycInitResult> {
  const provider = resolveKycProvider(serviceId);
  let result: KycInitResult;

  if (provider === "didit") {
    result = await createDiditSession(email, callbackUrl);
  } else {
    result = await createOrResumePersonaInquiry(email);
  }

  // Upsert session record — one active session per user per provider.
  await prisma.peerRampKycSession.upsert({
    where: { email_provider: { email, provider } },
    create: {
      email,
      provider,
      externalId: result.externalId,
      status: "initiated",
    },
    update: {
      externalId: result.externalId,
      status: "initiated",
    },
  });

  return result;
}

/** Current KYC status for a **Peer Ramp app** user (`PeerRampAppUser` by email). */
export async function getKycStatus(email: string): Promise<KycStatusResult> {
  const user = await prisma.peerRampAppUser.findUnique({
    where: { email },
    select: { kycStatus: true, kycVerifiedAt: true },
  });
  return {
    kycStatus: (user?.kycStatus as KycStatusResult["kycStatus"]) ?? null,
    kycVerifiedAt: user?.kycVerifiedAt ?? null,
  };
}

/**
 * Pull the latest Didit decision from their API and update `PeerRampKycSession` + `PeerRampAppUser`.
 * Use after browser redirect (`?verificationSessionId=`) when webhooks are unavailable (e.g. localhost),
 * or as a manual "refresh from provider" action (`verificationSessionId` omitted → last stored session id).
 */
export async function syncPeerRampDiditFromDecisionApi(
  email: string,
  verificationSessionId?: string | null
): Promise<SyncDiditKycResult> {
  const emailNorm = email.trim().toLowerCase();
  let sessionId = verificationSessionId?.trim() ?? "";
  if (!sessionId) {
    const row = await prisma.peerRampKycSession.findUnique({
      where: { email_provider: { email, provider: "didit" } },
      select: { externalId: true },
    });
    sessionId = row?.externalId?.trim() ?? "";
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
    const row = await prisma.peerRampKycSession.findUnique({
      where: { email_provider: { email, provider: "didit" } },
      select: { externalId: true },
    });
    if (row?.externalId !== sessionId) {
      return { ok: false, error: "Session does not match your verification.", code: "SESSION_MISMATCH" };
    }
  }

  const respSessionId = String(
    decision.session_id ?? decision.sessionId ?? sessionId
  ).trim();
  const rawStatus = String(decision.status ?? "").trim();
  if (!rawStatus) {
    return { ok: false, error: "Didit returned no status for this session.", code: "NO_STATUS" };
  }

  const sid = respSessionId || sessionId;
  const normalised = mapDiditStatus(rawStatus);
  await upsertKycResult(email, "didit", sid, normalised, rawStatus, decision);
  const kyc = await getKycStatus(email);
  return { ok: true, kyc };
}

/**
 * DIDIT webhook: verifies signature, updates **Peer Ramp** `PeerRampKycSession` + `PeerRampAppUser` only.
 * Returns false if signature is invalid.
 */
export async function processDiditWebhook(
  rawBody: Buffer | undefined,
  headers: Record<string, string | string[] | undefined>,
  parsedBody?: unknown
): Promise<boolean> {
  if (!verifyDiditWebhookSignature(rawBody, headers, parsedBody)) return false;

  let payload: DiditWebhookPayload;
  if (parsedBody && typeof parsedBody === "object") {
    payload = parsedBody as DiditWebhookPayload;
  } else if (rawBody !== undefined && rawBody.length > 0) {
    payload = parseDiditWebhook(rawBody);
  } else {
    return false;
  }

  const { session_id, status, vendor_data, webhook_type } = payload;

  // Only process status updates
  if (webhook_type !== "status.updated" || !session_id || !status) return true;

  const email = vendor_data?.trim();
  if (!email || !email.includes("@")) return true;

  const normalised = mapDiditStatus(status);

  const rampUser = await prisma.peerRampAppUser.findUnique({
    where: { email },
    select: { email: true },
  });
  if (rampUser) {
    await upsertKycResult(email, "didit", session_id, normalised, status, payload);
    return true;
  }

  await upsertPortalUserFromDiditWebhook(email, session_id, normalised, status, payload);
  return true;
}

/**
 * Persona webhook: verifies signature, updates **Peer Ramp** `PeerRampKycSession` + `PeerRampAppUser` only.
 * Returns false if signature is invalid.
 */
export async function processPersonaWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): Promise<boolean> {
  if (!verifyPersonaWebhookSignature(rawBody, headers)) return false;

  const payload = parsePersonaWebhook(rawBody);
  const email = getPersonaWebhookEmail(payload);
  const inquiryId = getPersonaWebhookInquiryId(payload);
  const rawStatus = getPersonaWebhookStatus(payload);

  if (!email || !inquiryId || !rawStatus) return true;
  if (!email.includes("@")) return true;

  const normalised = mapPersonaStatus(rawStatus);
  await upsertKycResult(email, "persona", inquiryId, normalised, rawStatus, payload);
  return true;
}

/**
 * Shared: upsert session + update **PeerRampAppUser** KYC fields (ramp consumers only).
 * Terminal statuses are never downgraded.
 */
async function upsertKycResult(
  email: string,
  provider: KycProvider,
  externalId: string,
  normalisedStatus: string,
  rawStatus: string,
  rawPayload: unknown
): Promise<void> {
  // Upsert session
  await prisma.peerRampKycSession.upsert({
    where: { email_provider: { email, provider } },
    create: {
      email,
      provider,
      externalId,
      status: rawStatus,
      rawPayload: rawPayload as never,
    },
    update: {
      externalId,
      status: rawStatus,
      rawPayload: rawPayload as never,
    },
  });

  // Don't downgrade from a terminal status
  const user = await prisma.peerRampAppUser.findUnique({
    where: { email },
    select: { kycStatus: true },
  });

  if (user && TERMINAL_STATUSES.has(user.kycStatus ?? "")) {
    // Already terminal — skip update unless new status is also terminal (e.g. approved → declined not allowed)
    return;
  }

  const isTerminal = TERMINAL_STATUSES.has(normalisedStatus);
  await prisma.peerRampAppUser.upsert({
    where: { email },
    create: {
      email,
      kycStatus: normalisedStatus,
      kycProvider: provider,
      kycVerifiedAt: isTerminal ? new Date() : null,
    },
    update: {
      kycStatus: normalisedStatus,
      kycProvider: provider,
      kycVerifiedAt: isTerminal ? new Date() : undefined,
    },
  });
}
