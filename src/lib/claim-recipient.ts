import { timingSafeEqual } from "node:crypto";

/** Normalize email (lowercase) or phone (strip spaces/dashes) for comparison. */
export function normalizeClaimRecipient(raw: string): string {
  const s = raw.trim();
  if (s.includes("@")) return s.toLowerCase();
  return s.replace(/[\s-]/g, "");
}

export function claimRecipientsMatch(stored: string, input: string): boolean {
  return normalizeClaimRecipient(stored) === normalizeClaimRecipient(input);
}

/** Partial hint for UI (e.g. j***@domain.com or +233…12). Does not reveal full identifier. */
export function maskRecipientHint(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes("@")) {
    const [local, domain] = s.toLowerCase().split("@");
    if (!domain || !local) return "***@***";
    const l = local.length <= 2 ? "*" : `${local[0]}***${local[local.length - 1]}`;
    return `${l}@${domain}`;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `…${digits.slice(-4)}`;
}

export function timingSafeOtp(otp: string, expected: string): boolean {
  const a = expected.trim().replace(/\D/g, "").padStart(6, "0").slice(-6);
  const b = otp.trim().replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (a.length !== 6 || b.length !== 6) return false;
  if (!/^\d{6}$/.test(a) || !/^\d{6}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function timingSafeClaimCode(code: string, expected: string): boolean {
  const a = expected.trim().toUpperCase();
  const b = code.trim().toUpperCase();
  if (a.length !== 6 || b.length !== 6) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
