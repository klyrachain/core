/**
 * Email service via Resend. All sends include X-Entity-Ref-ID and idempotency key.
 * No-ops when RESEND_API_KEY is not set (log only).
 * Set RESEND_FROM_EMAIL to your verified domain (e.g. noreply@yourdomain.com) to send to any recipient.
 * When unset, defaults to Resend testing sender (onboarding@resend.dev), which can only send to your own email.
 * Failed sends are retried once, then queued for processing on next server startup.
 */

import { Resend } from "resend";
import { getEnv } from "../config/env.js";
import { createIdempotencyKey, emailHeaders } from "../lib/email.utils.js";
import { pushPendingEmail, getNextPendingEmail } from "../lib/redis.js";

/** Fallback when RESEND_FROM_EMAIL is unset (Resend testing; only sends to your own email). */
const DEFAULT_FROM = "Morapay No-Reply <onboarding@resend.dev>";

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

async function sendEmailOnce(params: SendEmailParams, from: string): Promise<SendEmailResult> {
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

const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS_PENDING = 3;

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const env = getEnv();
  const from = env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;

  let result = await sendEmailOnce(params, from);

  if (!result.ok && RETRY_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    result = await sendEmailOnce(params, from);
  }

  if (!result.ok) {
    await pushPendingEmail({ ...params, _attempts: 1 }).catch((e) =>
      console.warn("[email] Failed to queue pending email:", e)
    );
  }
  return result;
}

/**
 * Process pending emails (failed sends from previous runs). Call on server startup.
 * Sends each; on failure re-queues up to MAX_ATTEMPTS_PENDING times, then drops.
 */
export async function processPendingEmails(): Promise<{ sent: number; failed: number; skipped: number }> {
  const env = getEnv();
  const from = env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  if (!env.RESEND_API_KEY) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (;;) {
    const payload = await getNextPendingEmail();
    if (!payload) break;

    const { _attempts: _, ...params } = payload;
    const toSend: SendEmailParams = { ...params, entityRefId: payload.entityRefId };

    const result = await sendEmailOnce(toSend, from);
    if (result.ok) {
      sent++;
    } else {
      const nextAttempts = (payload._attempts ?? 1) + 1;
      if (nextAttempts > MAX_ATTEMPTS_PENDING) {
        skipped++;
        console.warn(`[email] Pending email dropped after ${MAX_ATTEMPTS_PENDING} attempts (entityRefId=${payload.entityRefId}): ${result.error}`);
      } else {
        await pushPendingEmail({ ...payload, _attempts: nextAttempts }).catch(() => {});
        failed++;
      }
    }
  }

  if (sent > 0 || failed > 0 || skipped > 0) {
    console.log(`[email] Pending queue processed: sent=${sent} failed=${failed} skipped=${skipped}`);
  }
  return { sent, failed, skipped };
}

/** Check if email sending is configured (for API responses that list available channels). */
export function isEmailConfigured(): boolean {
  const env = getEnv();
  return !!env.RESEND_API_KEY;
}
