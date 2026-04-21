import { Redis } from "ioredis";
import { getEnv } from "../config/env.js";

type RedisClient = InstanceType<typeof Redis>;

let redis: RedisClient | null = null;

const BALANCE_TTL_SECONDS = 60;

/** Validation cache: providers, chains, tokens. Refreshed every 24h. */
export const VALIDATION_CACHE_TTL_SECONDS = 86400; // 24h
export const VALIDATION_KEY_PROVIDERS = "validation:providers";
export const VALIDATION_KEY_CHAINS = "validation:chains";
export const VALIDATION_KEY_TOKENS = "validation:tokens";
export const VALIDATION_KEY_LOADED_AT = "validation:loaded_at";
/** Recent failed validations (list, max 1000). TTL 7 days. */
export const VALIDATION_FAILED_LIST_KEY = "validation:failed:list";
export const VALIDATION_FAILED_LIST_TTL_SECONDS = 604800; // 7d
/** Pricing quote (provider buy/sell, volatility). Required for onramp/offramp validation. */
export const VALIDATION_KEY_PRICING_QUOTE = "validation:pricing_quote";
/** Cost basis per chain+token (from inventory lots). Buy price = cost price for validation. */
export const VALIDATION_KEY_COST_BASIS_PREFIX = "validation:cost_basis:";
/** Platform fee (baseFeePercent, fixedFee). Required for fee validation. */
export const VALIDATION_KEY_PLATFORM_FEE = "validation:platform_fee";

/** Stored v1 quote by quoteId. Quotes expire in 30s; TTL 32s. */
export const QUOTE_KEY_PREFIX = "quote:";
export const QUOTE_TTL_SECONDS = 32;

export function quoteKey(quoteId: string): string {
  return `${QUOTE_KEY_PREFIX}${quoteId}`;
}

export async function getStoredQuote(quoteId: string): Promise<string | null> {
  const r = getRedis();
  return r.get(quoteKey(quoteId));
}

export async function setStoredQuote(quoteId: string, value: string, ttlSeconds = QUOTE_TTL_SECONDS): Promise<void> {
  const r = getRedis();
  await r.set(quoteKey(quoteId), value, "EX", ttlSeconds);
}

export async function deleteStoredQuote(quoteId: string): Promise<void> {
  const r = getRedis();
  await r.del(quoteKey(quoteId));
}

/** Claim OTP: store expected OTP for claim verification. TTL 10 min. */
export const CLAIM_OTP_KEY_PREFIX = "claim_otp:";
export const CLAIM_OTP_TTL_SECONDS = 600;

export function claimOtpKey(claimId: string): string {
  return `${CLAIM_OTP_KEY_PREFIX}${claimId}`;
}

export async function setClaimOtp(claimId: string, otp: string): Promise<void> {
  const r = getRedis();
  await r.set(claimOtpKey(claimId), otp, "EX", CLAIM_OTP_TTL_SECONDS);
}

export async function getClaimOtp(claimId: string): Promise<string | null> {
  const r = getRedis();
  return r.get(claimOtpKey(claimId));
}

export async function deleteClaimOtp(claimId: string): Promise<void> {
  const r = getRedis();
  await r.del(claimOtpKey(claimId));
}

/** Custodial send (Pay → email/phone): claim code + OTP payload for a SELL transaction id. TTL 7d. */
export const CUSTODIAL_SEND_PREFIX = "custodial_send:";
export const CUSTODIAL_SEND_TTL_SECONDS = 604800;

export function custodialSendKey(transactionId: string): string {
  return `${CUSTODIAL_SEND_PREFIX}${transactionId}`;
}

export async function setCustodialSendPayload(transactionId: string, payload: string): Promise<void> {
  const r = getRedis();
  await r.set(custodialSendKey(transactionId), payload, "EX", CUSTODIAL_SEND_TTL_SECONDS);
}

export async function getCustodialSendPayload(transactionId: string): Promise<string | null> {
  const r = getRedis();
  return r.get(custodialSendKey(transactionId));
}

export async function deleteCustodialSendPayload(transactionId: string): Promise<void> {
  const r = getRedis();
  await r.del(custodialSendKey(transactionId));
}

/** Reverse lookup: opaque claim link id → custodial SELL transaction id. Same TTL as custodial payload. */
export const CUSTODIAL_CLAIM_LINK_PREFIX = "custodial_claim_link:";

export function custodialClaimLinkKey(claimLinkId: string): string {
  return `${CUSTODIAL_CLAIM_LINK_PREFIX}${claimLinkId.trim().toLowerCase()}`;
}

export async function setCustodialClaimLinkIndex(claimLinkId: string, transactionId: string): Promise<void> {
  const r = getRedis();
  await r.set(custodialClaimLinkKey(claimLinkId), transactionId, "EX", CUSTODIAL_SEND_TTL_SECONDS);
}

export async function getCustodialTransactionIdByClaimLinkId(claimLinkId: string): Promise<string | null> {
  const r = getRedis();
  const v = await r.get(custodialClaimLinkKey(claimLinkId));
  return v?.trim() ?? null;
}

export async function deleteCustodialClaimLinkIndex(claimLinkId: string): Promise<void> {
  const r = getRedis();
  await r.del(custodialClaimLinkKey(claimLinkId));
}

/** After OTP verified for custodial unlock flow (before claim code). TTL 15m. */
export const CUSTODIAL_CLAIM_OTP_GATE_PREFIX = "custodial_claim_otp_gate:";
export const CUSTODIAL_CLAIM_OTP_GATE_TTL_SECONDS = 900;

export function custodialClaimOtpGateKey(claimLinkId: string): string {
  return `${CUSTODIAL_CLAIM_OTP_GATE_PREFIX}${claimLinkId.trim().toLowerCase()}`;
}

export async function setCustodialClaimOtpGate(claimLinkId: string, transactionId: string): Promise<void> {
  const r = getRedis();
  await r.set(custodialClaimOtpGateKey(claimLinkId), transactionId, "EX", CUSTODIAL_CLAIM_OTP_GATE_TTL_SECONDS);
}

export async function getCustodialClaimOtpGate(claimLinkId: string): Promise<string | null> {
  const r = getRedis();
  const v = await r.get(custodialClaimOtpGateKey(claimLinkId));
  return v?.trim() ?? null;
}

export async function deleteCustodialClaimOtpGate(claimLinkId: string): Promise<void> {
  const r = getRedis();
  await r.del(custodialClaimOtpGateKey(claimLinkId));
}

/** Short-lived session after claim code verified; used for GET details + POST claim. TTL 15m. */
export const CLAIM_UNLOCK_PREFIX = "claim_unlock:";
export const CLAIM_UNLOCK_TTL_SECONDS = 900;

export function claimUnlockKey(token: string): string {
  return `${CLAIM_UNLOCK_PREFIX}${token}`;
}

export async function setClaimUnlockSession(token: string, payload: string): Promise<void> {
  const r = getRedis();
  await r.set(claimUnlockKey(token), payload, "EX", CLAIM_UNLOCK_TTL_SECONDS);
}

export async function getClaimUnlockSession(token: string): Promise<string | null> {
  const r = getRedis();
  return r.get(claimUnlockKey(token));
}

export async function deleteClaimUnlockSession(token: string): Promise<void> {
  const r = getRedis();
  await r.del(claimUnlockKey(token));
}

/** Prevents concurrent POST /claims/claim payouts for the same claim or custodial tx. */
export const CLAIM_PAYOUT_LOCK_PREFIX = "claim_payout:";
export const CLAIM_PAYOUT_LOCK_TTL_SECONDS = 180;

export function claimPayoutLockKey(id: string): string {
  return `${CLAIM_PAYOUT_LOCK_PREFIX}${id}`;
}

/** Returns true if lock acquired (SET NX). */
export async function tryAcquireClaimPayoutLock(id: string): Promise<boolean> {
  const r = getRedis();
  const ok = await r.set(claimPayoutLockKey(id), "1", "EX", CLAIM_PAYOUT_LOCK_TTL_SECONDS, "NX");
  return ok === "OK";
}

export async function releaseClaimPayoutLock(id: string): Promise<void> {
  const r = getRedis();
  await r.del(claimPayoutLockKey(id));
}

export function costBasisKey(chain: string, token: string): string {
  return `${VALIDATION_KEY_COST_BASIS_PREFIX}${chain.toUpperCase()}:${token.toUpperCase()}`;
}

/** Admin auth WebAuthn: registration challenge by adminId; TTL 5 min. */
export const ADMIN_AUTH_REG_CHALLENGE_PREFIX = "admin-auth:reg:";
export const ADMIN_AUTH_REG_CHALLENGE_TTL = 300;
/** Admin auth WebAuthn: authentication challenge by email; TTL 5 min. */
export const ADMIN_AUTH_AUTH_CHALLENGE_PREFIX = "admin-auth:auth:";
export const ADMIN_AUTH_AUTH_CHALLENGE_TTL = 300;

/** Business portal WebAuthn: registration challenge by userId. */
export const PORTAL_PASSKEY_REG_PREFIX = "portal-passkey:reg:";
export const PORTAL_PASSKEY_REG_TTL = 300;
/** Business portal WebAuthn: authentication challenge by normalized email hash. */
export const PORTAL_PASSKEY_AUTH_PREFIX = "portal-passkey:auth:";
export const PORTAL_PASSKEY_AUTH_TTL = 300;

export type BalanceEntry = {
  amount: string;
  status: string;
  updatedAt: string;
};

export function getRedis(): RedisClient {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
      connectTimeout: 5000,
    });
  }
  return redis;
}

export function getRedisConnection(): RedisClient {
  return new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  });
}

/** Redis connection for BullMQ Worker (requires maxRetriesPerRequest: null for blocking commands). */
export function getRedisConnectionForWorker(): RedisClient {
  return new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });
}

export function balanceKey(chain: string, token: string): string {
  return `balance:${chain}:${token}`;
}

export async function getBalance(chain: string, token: string): Promise<BalanceEntry | null> {
  const r = getRedis();
  const raw = await r.hgetall(balanceKey(chain, token));
  if (!raw || Object.keys(raw).length === 0) return null;
  return raw as unknown as BalanceEntry;
}

/** TTL for balance keys when doing a full sync from DB (so validation sees them). */
export const BALANCE_SYNC_TTL_SECONDS = 3600; // 1 hour

export async function setBalance(
  chain: string,
  token: string,
  entry: BalanceEntry,
  ttlSeconds: number = BALANCE_TTL_SECONDS
): Promise<void> {
  const r = getRedis();
  const key = balanceKey(chain, token);
  await r.hset(key, entry as unknown as Record<string, string>);
  await r.expire(key, ttlSeconds);
}

export type BalanceKeyEntry = BalanceEntry & { chain: string; token: string };

export async function listBalanceKeys(limit = 100): Promise<BalanceKeyEntry[]> {
  const r = getRedis();
  const keys: string[] = [];
  const stream = r.scanStream({ match: "balance:*", count: limit });
  for await (const batch of stream) {
    keys.push(...(batch as string[]));
    if (keys.length >= limit) break;
  }
  const result: BalanceKeyEntry[] = [];
  for (const key of keys.slice(0, limit)) {
    const raw = await r.hgetall(key);
    if (!raw || Object.keys(raw).length === 0) continue;
    const m = key.match(/^balance:(.+):(.+)$/);
    if (m) {
      result.push({
        ...(raw as unknown as BalanceEntry),
        chain: m[1],
        token: m[2],
      });
    }
  }
  return result;
}

/** Pending emails (failed sends) to retry on next server startup. List of JSON payloads. */
export const PENDING_EMAILS_LIST_KEY = "pending_emails";
export const PENDING_EMAIL_TTL_DAYS = 7;

export type PendingEmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  entityRefId: string;
  idempotencyKey?: string;
  replyTo?: string;
  _attempts?: number;
};

export async function pushPendingEmail(payload: PendingEmailPayload): Promise<void> {
  const r = getRedis();
  const raw = JSON.stringify(payload);
  await r.lpush(PENDING_EMAILS_LIST_KEY, raw);
}

export async function getNextPendingEmail(): Promise<PendingEmailPayload | null> {
  const r = getRedis();
  const raw = await r.rpop(PENDING_EMAILS_LIST_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingEmailPayload;
  } catch {
    return null;
  }
}

export async function getPendingEmailCount(): Promise<number> {
  const r = getRedis();
  return r.llen(PENDING_EMAILS_LIST_KEY);
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
