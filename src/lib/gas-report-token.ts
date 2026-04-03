import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";

export type GasReportTokenPayload = {
  paymentLinkId: string;
  businessId: string;
  exp: number;
};

function getSecret(): string {
  const e = getEnv();
  return e.GAS_REPORT_HMAC_SECRET ?? e.ENCRYPTION_KEY;
}

export function signGasReportToken(payload: GasReportTokenPayload): string {
  const payloadJson = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payloadJson).digest("base64url");
  return `${payloadJson}.${sig}`;
}

export function verifyGasReportToken(token: string): GasReportTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadJson, sig] = parts;
  if (!payloadJson || !sig) return null;
  const expectedSig = createHmac("sha256", getSecret()).update(payloadJson).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadJson, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("paymentLinkId" in parsed) ||
    !("businessId" in parsed) ||
    !("exp" in parsed)
  ) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  const paymentLinkId = typeof o.paymentLinkId === "string" ? o.paymentLinkId : "";
  const businessId = typeof o.businessId === "string" ? o.businessId : "";
  const exp = typeof o.exp === "number" ? o.exp : 0;
  if (!paymentLinkId || !businessId || exp <= 0) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > exp) return null;
  return { paymentLinkId, businessId, exp };
}
