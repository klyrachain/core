/**
 * One-time codes to verify `Business.supportEmail` before persisting (merchant dashboard).
 * Stored in Redis; email uses the same Resend path as other product emails.
 */

import { createHash, randomInt } from "node:crypto";
import { getEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { sendEmail } from "./email.service.js";

const OTP_KEY_PREFIX = "merchant:support-email-otp:";
const COOLDOWN_KEY_PREFIX = "merchant:support-email-otp-cd:";
const OTP_TTL_SEC = 10 * 60;
const COOLDOWN_SEC = 60;

function otpPepper(): string {
  const secret = getEnv().ENCRYPTION_KEY ?? getEnv().PEER_RAMP_APP_JWT_SECRET ?? "dev";
  return createHash("sha256").update(`${secret}:merchant_support_email_otp`).digest("hex");
}

function hashOtpCode(email: string, code: string): string {
  const e = email.trim().toLowerCase();
  return createHash("sha256")
    .update(`${otpPepper()}:${e}:${code.trim()}`)
    .digest("hex");
}

type StoredOtp = {
  pendingEmail: string;
  codeHash: string;
  expiresAtMs: number;
};

function parseStored(raw: string | null): StoredOtp | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as StoredOtp;
    if (
      typeof o.pendingEmail === "string" &&
      typeof o.codeHash === "string" &&
      typeof o.expiresAtMs === "number"
    ) {
      return o;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function requestBusinessSupportEmailVerificationCode(
  businessId: string,
  emailRaw: string,
  businessName: string
): Promise<
  | { ok: true }
  | { ok: false; error: string; code: "INVALID_EMAIL" | "COOLDOWN" | "EMAIL_FAILED" }
> {
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@") || email.length > 254) {
    return { ok: false, error: "Invalid email address.", code: "INVALID_EMAIL" };
  }

  const redis = getRedis();
  const cdKey = `${COOLDOWN_KEY_PREFIX}${businessId}`;
  const ttl = await redis.ttl(cdKey);
  if (ttl > 0) {
    return {
      ok: false,
      error: "Please wait a minute before requesting another code.",
      code: "COOLDOWN",
    };
  }

  const code = String(randomInt(100000, 999999));
  const codeHash = hashOtpCode(email, code);
  const expiresAtMs = Date.now() + OTP_TTL_SEC * 1000;
  const payload: StoredOtp = { pendingEmail: email, codeHash, expiresAtMs };

  const otpKey = `${OTP_KEY_PREFIX}${businessId}`;
  await redis.set(otpKey, JSON.stringify(payload), "EX", OTP_TTL_SEC);
  await redis.set(cdKey, "1", "EX", COOLDOWN_SEC);

  const subject = "Your Morapay support email verification code";
  const safeName = businessName.trim() || "your business";
  const html = `
    <p>Hi,</p>
    <p>Use this code to confirm the support email for <strong>${escapeHtml(safeName)}</strong>:</p>
    <p style="font-size:22px;font-weight:700;letter-spacing:0.08em">${escapeHtml(code)}</p>
    <p>This code expires in ${Math.floor(OTP_TTL_SEC / 60)} minutes. If you did not request this, you can ignore this email.</p>
  `;
  const text = `Your verification code for ${safeName} is: ${code} (expires in ${Math.floor(OTP_TTL_SEC / 60)} minutes).`;

  const sent = await sendEmail({
    to: email,
    subject,
    html,
    text,
    entityRefId: `merchant-support-email-otp-${businessId}-${email}`,
    idempotencyKey: `merchant-support-email-otp-${businessId}-${Date.now()}`,
  });
  if (!sent.ok) {
    await redis.del(otpKey).catch(() => {});
    await redis.del(cdKey).catch(() => {});
    return {
      ok: false,
      error: sent.error ?? "Could not send verification email.",
      code: "EMAIL_FAILED",
    };
  }
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function verifyBusinessSupportEmailCodeAndSave(
  businessId: string,
  emailRaw: string,
  codeRaw: string
): Promise<
  | { ok: true }
  | { ok: false; error: string; code: "INVALID" | "EXPIRED" | "NOT_FOUND" | "MISMATCH" }
> {
  const email = emailRaw.trim().toLowerCase();
  const code = codeRaw.trim();
  if (!email || !code) {
    return { ok: false, error: "Email and code are required.", code: "INVALID" };
  }

  const redis = getRedis();
  const otpKey = `${OTP_KEY_PREFIX}${businessId}`;
  const raw = await redis.get(otpKey);
  const stored = parseStored(raw);
  if (!stored) {
    return { ok: false, error: "No verification is in progress. Request a new code.", code: "NOT_FOUND" };
  }
  if (Date.now() > stored.expiresAtMs) {
    await redis.del(otpKey).catch(() => {});
    return { ok: false, error: "That code has expired. Request a new one.", code: "EXPIRED" };
  }
  if (stored.pendingEmail !== email) {
    return { ok: false, error: "That code does not match this email address.", code: "MISMATCH" };
  }
  const expected = hashOtpCode(email, code);
  if (expected !== stored.codeHash) {
    return { ok: false, error: "Invalid verification code.", code: "INVALID" };
  }

  await prisma.business.update({
    where: { id: businessId },
    data: { supportEmail: email },
  });
  await redis.del(otpKey).catch(() => {});
  return { ok: true };
}
