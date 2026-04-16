/**
 * Peer-ramp web app: email OTP + session JWT (public routes; rate limit in handler).
 */

import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./email.service.js";

function jwtSecret(): string {
  return getEnv().PEER_RAMP_APP_JWT_SECRET ?? getEnv().ENCRYPTION_KEY;
}

function otpPepper(): string {
  return createHash("sha256").update(`${jwtSecret()}:peer_ramp_otp_pepper`).digest("hex");
}

function hashOtpCode(email: string, code: string): string {
  const e = email.trim().toLowerCase();
  return createHash("sha256")
    .update(`${otpPepper()}:${e}:${code}`)
    .digest("hex");
}

function toB64Url(data: object): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

export function signPeerRampAppSessionToken(email: string, cliSessionId: string): string {
  const secret = jwtSecret();
  const env = getEnv();
  const expSeconds = env.PEER_RAMP_APP_SESSION_SECONDS ?? 86_400;
  const header = toB64Url({ alg: "HS256", typ: "PRAPP" });
  const now = Math.floor(Date.now() / 1000);
  const payload = toB64Url({
    typ: "peer_ramp_app",
    email: email.trim().toLowerCase(),
    cliSessionId,
    iat: now,
    exp: now + expSeconds,
  });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verifyPeerRampAppSessionToken(
  token: string
): { email: string; cliSessionId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const secret = jwtSecret();
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      typ?: string;
      email?: string;
      cliSessionId?: string;
      exp?: number;
    };
    if (
      parsed.typ !== "peer_ramp_app" ||
      typeof parsed.email !== "string" ||
      typeof parsed.cliSessionId !== "string"
    ) {
      return null;
    }
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: parsed.email, cliSessionId: parsed.cliSessionId };
  } catch {
    return null;
  }
}

export async function requestPeerRampAppOtp(emailRaw: string): Promise<
  | { ok: true }
  | { ok: false; error: string; code: "INVALID_EMAIL" | "COOLDOWN" | "EMAIL_FAILED" }
> {
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@") || email.length > 254) {
    return { ok: false, error: "Invalid email", code: "INVALID_EMAIL" };
  }

  const env = getEnv();
  const cooldown = env.PEER_RAMP_APP_OTP_COOLDOWN_SECONDS ?? 60;
  const existing = await prisma.peerRampAppOtp.findUnique({ where: { email } });
  if (existing && Date.now() - existing.sentAt.getTime() < cooldown * 1000) {
    return { ok: false, error: "Please wait before requesting another code.", code: "COOLDOWN" };
  }

  const code = String(randomInt(100000, 999999));
  const codeHash = hashOtpCode(email, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const now = new Date();

  await prisma.peerRampAppOtp.upsert({
    where: { email },
    create: { email, codeHash, expiresAt, sentAt: now },
    update: { codeHash, expiresAt, sentAt: now },
  });

  const { peerRampAppOtpEmailHtml, peerRampAppOtpSubject } = await import(
    "../email/templates/peer-ramp-app-otp.js"
  );
  void sendEmail({
    to: email,
    subject: peerRampAppOtpSubject(),
    html: peerRampAppOtpEmailHtml({ code }),
    entityRefId: `peer-ramp-app-otp-${email}`,
    idempotencyKey: `peer-ramp-app-otp-${email}-${Date.now()}`,
  }).catch(() => {
    /* sendEmail logs */
  });

  return { ok: true };
}

export async function verifyPeerRampAppOtp(
  emailRaw: string,
  codeRaw: string
): Promise<
  | { ok: true; token: string; cliSessionId: string }
  | { ok: false; error: string; code: "INVALID" | "EXPIRED" | "NOT_FOUND" }
> {
  const email = emailRaw.trim().toLowerCase();
  const code = codeRaw.trim().replace(/\s/g, "");
  if (!email.includes("@") || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "Invalid email or code", code: "INVALID" };
  }

  const row = await prisma.peerRampAppOtp.findUnique({ where: { email } });
  if (!row) return { ok: false, error: "No active code for this email", code: "NOT_FOUND" };
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.peerRampAppOtp.delete({ where: { email } }).catch(() => {});
    return { ok: false, error: "Code expired", code: "EXPIRED" };
  }

  const expectedHash = hashOtpCode(email, code);
  const a = Buffer.from(expectedHash, "utf8");
  const b = Buffer.from(row.codeHash, "utf8");
  try {
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: "Invalid code", code: "INVALID" };
    }
  } catch {
    return { ok: false, error: "Invalid code", code: "INVALID" };
  }

  await prisma.peerRampAppOtp.delete({ where: { email } });

  const user = await prisma.peerRampAppUser.upsert({
    where: { email },
    create: { email },
    update: {},
  });

  const token = signPeerRampAppSessionToken(email, user.cliSessionId);
  return { ok: true, token, cliSessionId: user.cliSessionId };
}
