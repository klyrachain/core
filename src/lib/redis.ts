import { Redis } from "ioredis";
import { getEnv } from "../config/env.js";

type RedisClient = InstanceType<typeof Redis>;

let redis: RedisClient | null = null;

const BALANCE_TTL_SECONDS = 60;

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

export async function setBalance(
  chain: string,
  token: string,
  entry: BalanceEntry
): Promise<void> {
  const r = getRedis();
  const key = balanceKey(chain, token);
  await r.hset(key, entry as unknown as Record<string, string>);
  await r.expire(key, BALANCE_TTL_SECONDS);
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

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
