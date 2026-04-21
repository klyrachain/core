import { randomBytes, randomInt } from "crypto";

const ALPHANUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

/** Opaque hex id for claim URLs (same length style as Request.linkId). */
export function generateClaimLinkId(): string {
  return randomBytes(8).toString("hex");
}

/** Generate 6-digit OTP for claim verification (stored in Redis, single use). */
export function generateClaimOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Generate 6-character alphanumeric claim code (for URL / recipient to claim). */
export function generateClaimCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += ALPHANUM[randomInt(0, ALPHANUM.length)];
  }
  return s;
}
