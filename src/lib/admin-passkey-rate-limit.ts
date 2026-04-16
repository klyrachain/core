import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getRedis } from "./redis.js";

const PREFIX = "admin-auth:passkey-opt:";
const BUCKET_MS = 120_000;
const TTL_SEC = 150;
const MAX_PER_EMAIL_PER_BUCKET = 24;
const MAX_PER_IP_PER_BUCKET = 96;

function currentBucket(): string {
  return String(Math.floor(Date.now() / BUCKET_MS));
}

function emailFingerprint(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex").slice(0, 32);
}

function clientIpFingerprint(req: FastifyRequest): string {
  const xf = req.headers["x-forwarded-for"];
  const first =
    typeof xf === "string"
      ? xf.split(",")[0]?.trim() ?? ""
      : Array.isArray(xf)
        ? xf[0]?.trim() ?? ""
        : "";
  const ip = first || req.ip || req.socket.remoteAddress || "unknown";
  return createHash("sha256").update(ip, "utf8").digest("hex").slice(0, 24);
}

/**
 * Limits passkey login option requests per email and per client to reduce enumeration and abuse.
 * Fails open if Redis errors so availability matches other admin-auth Redis usage.
 */
export async function assertAdminPasskeyOptionsRateLimit(
  req: FastifyRequest,
  normalizedEmail: string
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  try {
    const redis = getRedis();
    const b = currentBucket();
    const eKey = `${PREFIX}e:${emailFingerprint(normalizedEmail)}:${b}`;
    const iKey = `${PREFIX}i:${clientIpFingerprint(req)}:${b}`;
    const emailCount = await redis.incr(eKey);
    if (emailCount === 1) await redis.expire(eKey, TTL_SEC);
    const ipCount = await redis.incr(iKey);
    if (ipCount === 1) await redis.expire(iKey, TTL_SEC);
    if (emailCount > MAX_PER_EMAIL_PER_BUCKET || ipCount > MAX_PER_IP_PER_BUCKET) {
      return { ok: false, retryAfterSec: TTL_SEC };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
