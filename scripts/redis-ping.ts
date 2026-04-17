/**
 * Verifies Redis using the same REDIS_URL resolution as Core (loadEnv).
 * ENCRYPTION_KEY is not used for Redis — only for app crypto / JWT defaults (see env.ts).
 *
 * Usage (from core/): pnpm exec tsx scripts/redis-ping.ts
 */
import { loadEnv, getEnv } from "../src/config/env.js";
import Redis from "ioredis";

function maskRedisUrl(u: string): string {
  try {
    const parsed = new URL(u);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[could not parse URL for masking]";
  }
}

async function main(): Promise<void> {
  const hadExplicitRedisUrl = Boolean(process.env.REDIS_URL?.trim());
  const hadDiscrete =
    Boolean(process.env.REDIS_HOST?.trim()) &&
    (Boolean(process.env.REDIS_PASSWORD?.trim()) ||
      Boolean(process.env.REDIS_USERNAME?.trim()));

  loadEnv();
  const { REDIS_URL } = getEnv();

  console.log("[redis-ping] Source:");
  console.log(
    `  REDIS_URL env set explicitly: ${hadExplicitRedisUrl} (host-only URLs still merge REDIS_PASSWORD if set)`
  );
  console.log(`  Discrete REDIS_HOST + auth present: ${hadDiscrete}`);
  console.log(
    `  REDIS_TLS: ${String(process.env.REDIS_TLS)} (use true for TLS / rediss:// on Redis Cloud)`
  );
  console.log(`  Effective URL (masked): ${maskRedisUrl(REDIS_URL)}`);
  console.log(
    "[redis-ping] ENCRYPTION_KEY is not used for Redis; it is for wallet encryption and JWT/HMAC fallbacks.\n"
  );

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
    retryStrategy: () => null,
  });

  try {
    const pong = await client.ping();
    if (pong !== "PONG") {
      throw new Error(`Unexpected PING reply: ${pong}`);
    }
    const testKey = "klyra:redis-ping-test";
    await client.set(testKey, "ok", "EX", 10);
    const v = await client.get(testKey);
    await client.del(testKey);
    if (v !== "ok") {
      throw new Error(`SET/GET round-trip failed: ${v}`);
    }
    console.log("[redis-ping] OK — PING and SET/GET succeeded.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[redis-ping] FAILED:", msg);
    if (/NOAUTH|Authentication required/i.test(msg)) {
      console.error(
        "\nHint: Server requires AUTH. Put user:pass in REDIS_URL, or set REDIS_PASSWORD (optional REDIS_USERNAME; defaults to \"default\") — Core merges them when the URL has no credentials."
      );
      console.error(
        "Redis Cloud often needs TLS: set REDIS_TLS=true (uses rediss://). Unset REDIS_URL and use REDIS_HOST/PORT/USER/PASS if you prefer discrete vars only."
      );
    }
    process.exitCode = 1;
  } finally {
    await client.quit().catch(() => {});
  }
}

void main();
