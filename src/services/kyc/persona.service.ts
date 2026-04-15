/**
 * Persona KYC service — server-side inquiry management.
 * API: https://api.withpersona.com/api/v1
 * Auth: Bearer API key. Sandbox key starts with persona_sandbox_.
 * Same endpoint for sandbox + production (key determines environment).
 *
 * Embedded flow: backend pre-creates inquiry, returns inquiryId + optional sessionToken
 * to the frontend, which initialises the Persona CDN client.
 * No npm SDK is used; only fetch + CDN script on the client side.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { getEnv } from "../../config/env.js";
import type { KycInitResult, PersonaWebhookPayload } from "./kyc.types.js";

const PERSONA_API_BASE = "https://api.withpersona.com/api/v1";
const PERSONA_VERSION = "2025-10-27";

function getPersonaConfig() {
  const env = getEnv();
  if (!env.PERSONA_API_KEY) throw new Error("PERSONA_API_KEY is not configured.");
  if (!env.PERSONA_TEMPLATE_ID)
    throw new Error("PERSONA_TEMPLATE_ID is not configured.");
  return {
    apiKey: env.PERSONA_API_KEY,
    templateId: env.PERSONA_TEMPLATE_ID,
    environmentId: env.PERSONA_ENVIRONMENT_ID,
    webhookSecret: env.PERSONA_WEBHOOK_SECRET,
  };
}

function personaHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Persona-Version": PERSONA_VERSION,
  };
}

/**
 * Find any incomplete inquiry for a user by reference-id.
 * Returns null if none found.
 */
async function findIncompleteInquiry(
  email: string,
  apiKey: string
): Promise<{ id: string; status: string } | null> {
  const url = new URL(`${PERSONA_API_BASE}/inquiries`);
  url.searchParams.set("filter[reference-id]", email);
  url.searchParams.set("filter[status]", "created,pending");
  url.searchParams.set("page[size]", "1");

  const res = await fetch(url.toString(), {
    headers: personaHeaders(apiKey),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    data?: Array<{ id: string; attributes: { status: string } }>;
  };
  const first = body.data?.[0];
  if (!first) return null;
  return { id: first.id, status: first.attributes.status };
}

/**
 * Create a new Persona inquiry for the given email.
 */
async function createInquiry(email: string, apiKey: string, templateId: string): Promise<string> {
  const res = await fetch(`${PERSONA_API_BASE}/inquiries`, {
    method: "POST",
    headers: personaHeaders(apiKey),
    body: JSON.stringify({
      data: {
        attributes: {
          "inquiry-template-id": templateId,
          "reference-id": email,
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Persona inquiry creation failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/**
 * Generate a session token to allow a user to resume a pending inquiry.
 */
async function resumeInquiry(
  inquiryId: string,
  apiKey: string
): Promise<string | null> {
  const res = await fetch(`${PERSONA_API_BASE}/inquiries/${inquiryId}/resume`, {
    method: "POST",
    headers: personaHeaders(apiKey),
    body: JSON.stringify({ meta: {} }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { meta?: { "session-token"?: string } };
  return body.meta?.["session-token"] ?? null;
}

/**
 * Get or create a Persona inquiry for the given email.
 * - If an incomplete inquiry exists with status "pending", resumes it (returns session token).
 * - If an incomplete inquiry exists with status "created", returns it without a session token.
 * - Otherwise creates a fresh inquiry.
 */
export async function createOrResumePersonaInquiry(
  email: string
): Promise<KycInitResult> {
  const { apiKey, templateId, environmentId } = getPersonaConfig();

  const existing = await findIncompleteInquiry(email, apiKey);
  let inquiryId: string;
  let sessionToken: string | null = null;

  if (existing) {
    inquiryId = existing.id;
    if (existing.status === "pending") {
      sessionToken = await resumeInquiry(inquiryId, apiKey);
    }
  } else {
    inquiryId = await createInquiry(email, apiKey, templateId);
  }

  return {
    provider: "persona",
    externalId: inquiryId,
    inquiryId,
    sessionToken,
    environmentId,
  };
}

/**
 * Map raw Persona inquiry status to our normalised KycStatus.
 */
export function mapPersonaStatus(raw: string): string {
  switch (raw) {
    case "approved":
      return "approved";
    case "declined":
    case "failed":
      return "declined";
    case "needs_review":
    case "marked_for_review":
      return "in_review";
    default:
      // created, pending, completed (pre-workflow), etc.
      return "pending";
  }
}

/**
 * Verify Persona webhook signature.
 * Header format: Persona-Signature: t={unix_ts},v1={hmac_hex}
 * Signed value: "{t}.{raw_body}"
 */
export function verifyPersonaWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const env = getEnv();
  const secret = env.PERSONA_WEBHOOK_SECRET;
  if (!secret) return false;

  const header = (
    headers["persona-signature"] ??
    headers["Persona-Signature"] ??
    ""
  ) as string;
  if (!header) return false;

  const parts = header.split(",");
  let timestamp = "";
  const sigs: string[] = [];

  for (const part of parts) {
    const [k, v] = part.split("=", 2);
    if (k === "t") timestamp = v ?? "";
    if (k === "v1") sigs.push(v ?? "");
  }

  if (!timestamp || sigs.length === 0) return false;

  // Timestamp freshness (5 minutes)
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return sigs.some((sig) => {
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
    } catch {
      return false;
    }
  });
}

/**
 * Parse a Persona webhook body and extract the inquiry id + status.
 */
export function parsePersonaWebhook(rawBody: Buffer): PersonaWebhookPayload {
  return JSON.parse(rawBody.toString("utf8")) as PersonaWebhookPayload;
}

/**
 * Extract the reference-id (email) from a Persona webhook payload.
 */
export function getPersonaWebhookEmail(payload: PersonaWebhookPayload): string | null {
  return payload.data?.attributes?.["reference-id"] ?? null;
}

/**
 * Extract the inquiry id from a Persona webhook payload.
 */
export function getPersonaWebhookInquiryId(payload: PersonaWebhookPayload): string | null {
  return payload.data?.id ?? null;
}

/**
 * Extract the inquiry status from a Persona webhook payload.
 */
export function getPersonaWebhookStatus(payload: PersonaWebhookPayload): string | null {
  return payload.data?.attributes?.status ?? null;
}
