/**
 * DIDIT KYC service.
 * API: https://verification.didit.me/v3/
 * Auth: x-api-key header. Same endpoint for sandbox + production (credentials differ).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { getEnv } from "../../config/env.js";
import type { KycInitResult, DiditWebhookPayload } from "./kyc.types.js";

const DIDIT_API_BASE = "https://verification.didit.me/v3";

/** Person KYC vs business KYB vs portal member KYC — different Didit workflow IDs from env. */
export type DiditWorkflowKind = "kyc" | "kyb" | "portal_kyc";

export function getDiditWorkflowId(kind: DiditWorkflowKind): string {
  const env = getEnv();
  if (kind === "kyb") {
    const id = env.DIDIT_KYB_WORKFLOW_ID?.trim();
    if (!id) throw new Error("DIDIT_KYB_WORKFLOW_ID is not configured.");
    return id;
  }
  if (kind === "portal_kyc") {
    const id = env.DIDIT_PORTAL_KYC_WORKFLOW_ID?.trim() || env.DIDIT_WORKFLOW_ID?.trim();
    if (!id) {
      throw new Error(
        "DIDIT_PORTAL_KYC_WORKFLOW_ID or DIDIT_WORKFLOW_ID is not configured for portal KYC."
      );
    }
    return id;
  }
  const id = env.DIDIT_WORKFLOW_ID?.trim();
  if (!id) throw new Error("DIDIT_WORKFLOW_ID is not configured.");
  return id;
}

function getDiditConfig(kind: DiditWorkflowKind = "kyc") {
  const env = getEnv();
  if (!env.DIDIT_API_KEY) throw new Error("DIDIT_API_KEY is not configured.");
  if (!env.DIDIT_CLIENT_ID) throw new Error("DIDIT_CLIENT_ID is not configured.");
  const workflowId = getDiditWorkflowId(kind);
  return {
    apiKey: env.DIDIT_API_KEY,
    clientId: env.DIDIT_CLIENT_ID,
    workflowId,
    webhookSecret: env.DIDIT_WEBHOOK_SECRET,
  };
}

/**
 * Create a DIDIT verification session for the given user.
 * `callbackUrl` is the URL DIDIT redirects to after the user completes verification.
 */
export async function createDiditSession(
  email: string,
  callbackUrl: string,
  options?: { workflowKind?: DiditWorkflowKind }
): Promise<KycInitResult> {
  const kind = options?.workflowKind ?? "kyc";
  const { apiKey, clientId, workflowId } = getDiditConfig(kind);

  const res = await fetch(`${DIDIT_API_BASE}/session/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      client_id: clientId,
      workflow_id: workflowId,
      callback: callbackUrl,
      vendor_data: email,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`DIDIT session creation failed (${res.status}): ${text}`);
  }

  // Didit v3 returns the hosted flow link as `url` (docs); some clients use verification_url / camelCase.
  const data = (await res.json()) as Record<string, unknown>;

  const sessionId = String(data.session_id ?? data.sessionId ?? "").trim();
  if (!sessionId) {
    throw new Error("DIDIT session response missing session_id");
  }

  const verificationUrl = String(
    data.verification_url ?? data.verificationUrl ?? data.url ?? ""
  ).trim();
  if (!verificationUrl) {
    throw new Error("DIDIT session response missing url (verification link)");
  }

  return {
    provider: "didit",
    externalId: sessionId,
    verificationUrl,
  };
}

/**
 * Map raw DIDIT status string to our normalised KycStatus.
 * Exact, case-sensitive matching per DIDIT docs.
 */
export function mapDiditStatus(raw: string): string {
  switch (raw) {
    case "Approved":
      return "approved";
    case "Declined":
    case "Kyc Expired":
      return "declined";
    case "In Review":
      return "in_review";
    case "Resubmitted":
      return "resubmitting";
    default:
      return "pending";
  }
}

/**
 * GET /v3/session/{sessionId}/decision/ — poll verification outcome (same data webhooks use).
 * @see https://docs.didit.me/sessions-api/retrieve-session
 */
export async function fetchDiditSessionDecision(
  sessionId: string
): Promise<Record<string, unknown>> {
  const { apiKey } = getDiditConfig();
  const id = encodeURIComponent(sessionId.trim());
  const res = await fetch(`${DIDIT_API_BASE}/session/${id}/decision/`, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`DIDIT session decision failed (${res.status}): ${text}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function headerOne(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== target) continue;
    const v = headers[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0].trim();
  }
  return "";
}

/**
 * Verify DIDIT webhook signatures (X-Signature-V2 preferred, X-Signature-Simple fallback).
 *
 * If `rawBody` is missing (some proxies) but Fastify parsed JSON into `parsedFallback`, we still
 * verify using the same canonical JSON Didit uses for V2.
 *
 * @see https://docs.didit.me/integration/webhooks
 */
export function verifyDiditWebhookSignature(
  rawBody: Buffer | undefined,
  headers: Record<string, string | string[] | undefined>,
  parsedFallback?: unknown
): boolean {
  const { webhookSecret } = getDiditConfig();
  if (!webhookSecret) return false;

  const sigV2 = headerOne(headers, "x-signature-v2");
  const sigSimple = headerOne(headers, "x-signature-simple");
  const timestamp = headerOne(headers, "x-timestamp");

  if (!timestamp || (!sigV2 && !sigSimple)) return false;

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return false;
  }

  let parsed: unknown;
  if (rawBody !== undefined && rawBody.length > 0) {
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return false;
    }
  } else if (
    parsedFallback !== undefined &&
    parsedFallback !== null &&
    typeof parsedFallback === "object"
  ) {
    parsed = parsedFallback;
  } else {
    return false;
  }

  if (sigV2 && verifyDiditSignatureV2(parsed, sigV2, webhookSecret)) return true;
  if (sigSimple && verifyDiditSignatureSimple(parsed, sigSimple, webhookSecret)) return true;
  return false;
}

/** Didit V2: HMAC-SHA256 of JSON.stringify(sortKeys(shortenFloats(body))), utf8 digest hex. */
function verifyDiditSignatureV2(
  parsed: unknown,
  signatureHeader: string,
  secret: string
): boolean {
  const canonicalJson = JSON.stringify(sortKeysDidit(shortenFloats(parsed)));
  const expected = createHmac("sha256", secret).update(canonicalJson, "utf8").digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signatureHeader, "utf8")
    );
  } catch {
    return false;
  }
}

/** Didit Simple: HMAC-SHA256 of "{timestamp}:{session_id}:{status}:{webhook_type}". */
function verifyDiditSignatureSimple(
  parsed: unknown,
  signatureHeader: string,
  secret: string
): boolean {
  const o = parsed as Record<string, unknown>;
  const canonicalString = [
    String(o.timestamp ?? ""),
    String(o.session_id ?? ""),
    String(o.status ?? ""),
    String(o.webhook_type ?? ""),
  ].join(":");
  const expected = createHmac("sha256", secret).update(canonicalString, "utf8").digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signatureHeader, "utf8")
    );
  } catch {
    return false;
  }
}

/** Recursive key sort matching Didit docs (`Object.keys(obj).sort()`). */
function sortKeysDidit(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDidit);
  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDidit(record[key]);
        return acc;
      }, {});
  }
  return obj;
}

/** Match DIDIT's shortenFloats: whole-number floats → integers. */
function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [
        k,
        shortenFloats(val),
      ])
    );
  }
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) {
    return Math.trunc(v);
  }
  return v;
}

/**
 * Parse a DIDIT webhook payload from a raw buffer.
 */
export function parseDiditWebhook(rawBody: Buffer): DiditWebhookPayload {
  return JSON.parse(rawBody.toString("utf8")) as DiditWebhookPayload;
}
