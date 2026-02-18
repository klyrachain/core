/**
 * Sent.dm messaging service: SMS and WhatsApp via unified API.
 * Uses templates created in Sent.dm dashboard; template IDs in env.
 * No-ops when SENT_DM_API_KEY or SENT_DM_SENDER_ID is not set.
 */

import { getEnv } from "../config/env.js";

const SENT_API_BASE = "https://api.sent.dm";

export type SendToPhoneParams = {
  /** E.164 or similar (e.g. +233541234567) */
  phoneNumber: string;
  /** Sent.dm template UUID */
  templateId: string;
  /** Variables to replace in template (e.g. { "name": "John", "link": "https://..." }) */
  templateVariables?: Record<string, string>;
};

export type SendToPhoneResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendMessageToPhone(params: SendToPhoneParams): Promise<SendToPhoneResult> {
  const env = getEnv();
  if (!env.SENT_DM_API_KEY || !env.SENT_DM_SENDER_ID) {
    return { ok: false, error: "Sent.dm not configured (SENT_DM_API_KEY or SENT_DM_SENDER_ID missing)" };
  }

  const phone = params.phoneNumber.trim().startsWith("+") ? params.phoneNumber.trim() : `+${params.phoneNumber.trim()}`;

  const res = await fetch(`${SENT_API_BASE}/v2/messages/phone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.SENT_DM_API_KEY,
      "x-sender-id": env.SENT_DM_SENDER_ID,
    },
    body: JSON.stringify({
      phoneNumber: phone,
      templateId: params.templateId,
      templateVariables: params.templateVariables ?? {},
    }),
  });

  if (res.status === 204) return { ok: true };
  const text = await res.text();
  let err = `Sent.dm API ${res.status}`;
  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    err = json.message ?? json.error ?? err;
  } catch {
    if (text) err = text;
  }
  return { ok: false, error: err };
}

/** Check if Sent.dm is configured (for API responses that list available channels). */
export function isSentConfigured(): boolean {
  const env = getEnv();
  return !!(env.SENT_DM_API_KEY && env.SENT_DM_SENDER_ID);
}
