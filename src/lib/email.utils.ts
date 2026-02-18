import { randomUUID } from "crypto";

/** Generate idempotency key for Resend (prevents duplicate sends on retry). */
export function createIdempotencyKey(): string {
  return randomUUID();
}

/** Build headers for Resend: X-Entity-Ref-ID for tracing + optional idempotency (Resend uses separate option). */
export function emailHeaders(entityRefId: string): Record<string, string> {
  return {
    "X-Entity-Ref-ID": entityRefId,
  };
}
