/**
 * Plain SMS via Moolre (Ghana/Nigeria-focused; same API as backend moolre.service).
 * Used as fallback when Sent.dm SMS fails for claim OTP delivery.
 */

import { randomUUID } from "node:crypto";
import { getEnv } from "../config/env.js";

/** E.164-style numbers likely routable via Moolre SMS (GH +233, NG +234). */
export function isLikelyMoolreSmsDestination(phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("233") && d.length >= 12) return true;
  if (d.startsWith("234") && d.length >= 13) return true;
  if (d.startsWith("0") && d.length === 10 && d[1] === "2") {
    // 02… could be NG local — conservative: only if starts with 080/081/090 etc.
    return /^0(80|81|70|90|91)/.test(d);
  }
  return false;
}

export function isMoolreSmsConfigured(): boolean {
  const env = getEnv();
  return !!(env.MOOLRE_SMS_API_KEY?.trim() && env.MOOLRE_API_BASE_URL?.trim());
}

type MoolreSmsResponse = { status?: number | string; message?: string };

export async function sendMoolrePlainSms(recipient: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = getEnv();
  const smsKey = env.MOOLRE_SMS_API_KEY?.trim();
  const base = (env.MOOLRE_API_BASE_URL ?? "https://api.moolre.com").replace(/\/$/, "");
  const senderId = env.MOOLRE_SMS_SENDER_ID?.trim() ?? "";
  if (!smsKey) return { ok: false, error: "Moolre SMS not configured" };

  const payload = {
    type: 1,
    senderid: senderId,
    messages: [{ recipient: recipient.trim(), message, ref: randomUUID() }],
  };

  const res = await fetch(`${base}/open/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-VASKEY": smsKey },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: MoolreSmsResponse = {};
  try {
    parsed = JSON.parse(text) as MoolreSmsResponse;
  } catch {
    /* ignore */
  }
  const ok = res.ok && (parsed.status === 1 || parsed.status === "1");
  if (ok) return { ok: true };
  return { ok: false, error: parsed.message ?? text.slice(0, 200) ?? `HTTP ${res.status}` };
}
