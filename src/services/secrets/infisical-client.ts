/**
 * Optional Infisical API v4 secret reads (Core-only). Disabled when token/project are unset.
 * Values are cached in memory with TTL; never log secret payloads.
 */

import { getEnv } from "../../config/env.js";

type CacheEntry = { value: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 200;
let inFlight = new Map<string, Promise<string | null>>();

function cacheKey(secretPath: string, secretName: string): string {
  return `${secretPath}\0${secretName}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  while (cache.size > MAX_CACHE_ENTRIES && sorted.length > 0) {
    const [k] = sorted.shift()!;
    cache.delete(k);
  }
}

export function isInfisicalConfigured(): boolean {
  try {
    const env = getEnv();
    return Boolean(
      env.INFISICAL_SERVICE_TOKEN?.trim() && env.INFISICAL_PROJECT_ID?.trim()
    );
  } catch {
    return false;
  }
}

async function fetchSecretUncached(
  secretName: string,
  secretPath: string
): Promise<string | null> {
  const env = getEnv();
  const token = env.INFISICAL_SERVICE_TOKEN?.trim();
  const projectId = env.INFISICAL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;

  const base = env.INFISICAL_SITE_URL.replace(/\/+$/, "");
  const environment = env.INFISICAL_ENVIRONMENT_SLUG.trim();
  const path = secretPath.startsWith("/") ? secretPath : `/${secretPath}`;
  const url = new URL(
    `${base}/api/v4/secrets/${encodeURIComponent(secretName)}`
  );
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("environment", environment);
  url.searchParams.set("secretPath", path === "" ? "/" : path);
  url.searchParams.set("viewSecretValue", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return null;
  }
  const json: unknown = await res.json().catch(() => null);
  if (!json || typeof json !== "object") return null;
  const secret = (json as { secret?: { secretValue?: string } }).secret;
  const val = secret?.secretValue;
  return typeof val === "string" && val.length > 0 ? val.trim() : null;
}

/**
 * Read a secret value by key name and folder path. Returns null if Infisical is not configured,
 * request fails, or secret is missing.
 */
export async function getInfisicalSecretValue(
  secretName: string,
  secretPath = "/"
): Promise<string | null> {
  if (!isInfisicalConfigured()) return null;
  const name = secretName.trim();
  if (!name) return null;
  const path = (secretPath.trim() || "/").replace(/\/+$/, "") || "/";
  const key = cacheKey(path, name);
  const env = getEnv();
  const ttl = env.INFISICAL_CACHE_TTL_MS;
  const now = Date.now();
  pruneCache();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const value = await fetchSecretUncached(name, path);
      if (value != null) {
        cache.set(key, { value, expiresAt: Date.now() + ttl });
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

/** For tests: clear in-memory cache. */
export function __clearInfisicalCacheForTests(): void {
  cache.clear();
  inFlight = new Map();
}
