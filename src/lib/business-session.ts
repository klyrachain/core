import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";

const JWT_EXP_SECONDS = 60 * 60 * 24 * 7;

function portalSecret(): string {
  const env = getEnv();
  return env.BUSINESS_PORTAL_JWT_SECRET ?? env.ENCRYPTION_KEY;
}

function toB64Url(data: object): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

export function signBusinessPortalToken(userId: string): string {
  const secret = portalSecret();
  const header = toB64Url({ alg: "HS256", typ: "BP" });
  const now = Math.floor(Date.now() / 1000);
  const payload = toB64Url({
    sub: userId,
    typ: "business_portal",
    iat: now,
    exp: now + JWT_EXP_SECONDS,
  });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verifyBusinessPortalToken(token: string): { userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const secret = portalSecret();
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
      sub?: string;
      typ?: string;
      exp?: number;
    };
    if (parsed.typ !== "business_portal" || typeof parsed.sub !== "string") return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: parsed.sub };
  } catch {
    return null;
  }
}
