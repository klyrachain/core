/**
 * Email service via Resend. All sends include X-Entity-Ref-ID and idempotency key.
 * No-ops when RESEND_API_KEY is not set (log only).
 */

import { Resend } from "resend";
import { getEnv } from "../config/env.js";
import { createIdempotencyKey, emailHeaders } from "../lib/email.utils.js";

export type SendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Entity reference for tracing (e.g. request id, transaction id). Sent as X-Entity-Ref-ID. */
  entityRefId: string;
  /** Optional idempotency key; if not provided, one is generated. */
  idempotencyKey?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (resendClient != null) return resendClient;
  const env = getEnv();
  if (!env.RESEND_API_KEY) return null;
  resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const env = getEnv();
  const from = env.RESEND_FROM_EMAIL ?? "Klyra <onboarding@resend.dev>";

  const client = getResend();
  if (!client) {
    return { ok: false, error: "Email not configured (RESEND_API_KEY missing)" };
  }

  const idempotencyKey = params.idempotencyKey ?? createIdempotencyKey();
  const headers = emailHeaders(params.entityRefId);

  const toList = Array.isArray(params.to) ? params.to : [params.to];

  const { data, error } = await client.emails.send(
    {
      from,
      to: toList,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo,
      headers,
    },
    { idempotencyKey }
  );

  if (error) {
    return { ok: false, error: error.message ?? String(error) };
  }
  return { ok: true, id: data?.id ?? "unknown" };
}

/** Check if email sending is configured (for API responses that list available channels). */
export function isEmailConfigured(): boolean {
  const env = getEnv();
  return !!env.RESEND_API_KEY;
}
