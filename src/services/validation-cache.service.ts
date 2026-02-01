/**
 * Validation cache: providers, chains, tokens. Loaded from DB once, stored in Redis, refreshed every 24h.
 * Used by order validation for fast lookups (no DB in hot path).
 */

import { getRedis } from "../lib/redis.js";
import {
  VALIDATION_KEY_PROVIDERS,
  VALIDATION_KEY_CHAINS,
  VALIDATION_KEY_TOKENS,
  VALIDATION_KEY_LOADED_AT,
  VALIDATION_KEY_PRICING_QUOTE,
  VALIDATION_KEY_PLATFORM_FEE,
  VALIDATION_CACHE_TTL_SECONDS,
  costBasisKey,
} from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import { getAverageCostBasis } from "./inventory.service.js";
import { getPlatformSettingOrDefault } from "./platform-settings.service.js";

export type CachedProvider = {
  code: string;
  enabled: boolean;
  operational: boolean;
  priority: number;
  fee: number | null;
};

export type CachedChain = {
  chainId: number;
  name: string;
  code: string; // uppercase for f_chain/t_chain match e.g. BASE, ETHEREUM
};

export type CachedToken = {
  chainId: number;
  symbol: string;
  tokenAddress: string;
};

export type CachedPlatformFee = {
  baseFeePercent: number;
  fixedFee: number;
};

export type CachedPricingQuote = {
  providerBuyPrice: number; // buy price: cost price from inventory (per token) or global default
  providerSellPrice: number;
  volatility: number;
  /** Cost price from inventory lots (floor for on-ramp). Present when chain+token provided. */
  costPrice?: number;
};

const PAYMENT_PROVIDER_CODES = ["NONE", "ANY", "KLYRA", "SQUID", "LIFI", "PAYSTACK"] as const;
const DEFAULT_PRICING_QUOTE: CachedPricingQuote = {
  providerBuyPrice: 1,
  providerSellPrice: 0.99,
  volatility: 0.01,
};

/** Load providers, chains, tokens from DB into Redis. Call on startup and every 24h. */
export async function loadValidationCache(): Promise<void> {
  const r = getRedis();

  const [providers, chains, tokens] = await Promise.all([
    prisma.providerRouting.findMany({
      select: { code: true, enabled: true, operational: true, priority: true, fee: true },
    }),
    prisma.chain.findMany({ select: { chainId: true, name: true } }),
    prisma.supportedToken.findMany({
      select: { chainId: true, symbol: true, tokenAddress: true },
    }),
  ]);

  const cachedProviders: CachedProvider[] = providers.map((p) => ({
    code: p.code,
    enabled: p.enabled,
    operational: p.operational,
    priority: p.priority,
    fee: p.fee == null ? null : Number(p.fee),
  }));

  // Include built-in provider codes that may not be in ProviderRouting (NONE, ANY, KLYRA)
  const codesSet = new Set(cachedProviders.map((x) => x.code));
  for (const code of PAYMENT_PROVIDER_CODES) {
    if (!codesSet.has(code)) {
      cachedProviders.push({
        code,
        enabled: true,
        operational: true,
        priority: 0,
        fee: null,
      });
    }
  }

  const cachedChains: CachedChain[] = chains.map((c) => ({
    chainId: c.chainId,
    name: c.name,
    code: c.name.toUpperCase(),
  }));

  const cachedTokens: CachedToken[] = tokens.map((t) => ({
    chainId: t.chainId,
    symbol: t.symbol,
    tokenAddress: t.tokenAddress,
  }));

  // Base platform fee (%) from Settings → financials.baseFeePercent; load into cache for validation.
  const DEFAULT_FINANCIALS = { baseFeePercent: 1, fixedFee: 0 };
  const financials = await getPlatformSettingOrDefault("financials", DEFAULT_FINANCIALS);
  const platformFee: CachedPlatformFee = {
    baseFeePercent: typeof financials.baseFeePercent === "number" ? Math.min(100, Math.max(0, financials.baseFeePercent)) : 1,
    fixedFee: typeof financials.fixedFee === "number" ? Math.max(0, financials.fixedFee) : 0,
  };

  const pipe = r.pipeline();
  pipe.set(VALIDATION_KEY_PROVIDERS, JSON.stringify(cachedProviders), "EX", VALIDATION_CACHE_TTL_SECONDS);
  pipe.set(VALIDATION_KEY_CHAINS, JSON.stringify(cachedChains), "EX", VALIDATION_CACHE_TTL_SECONDS);
  pipe.set(VALIDATION_KEY_TOKENS, JSON.stringify(cachedTokens), "EX", VALIDATION_CACHE_TTL_SECONDS);
  pipe.set(VALIDATION_KEY_PLATFORM_FEE, JSON.stringify(platformFee), "EX", VALIDATION_CACHE_TTL_SECONDS);
  pipe.set(VALIDATION_KEY_LOADED_AT, Date.now().toString(), "EX", VALIDATION_CACHE_TTL_SECONDS);
  await pipe.exec();

  const existingQuote = await r.get(VALIDATION_KEY_PRICING_QUOTE);
  if (!existingQuote) {
    await r.set(VALIDATION_KEY_PRICING_QUOTE, JSON.stringify(DEFAULT_PRICING_QUOTE), "EX", VALIDATION_CACHE_TTL_SECONDS);
  }

  await loadInventoryCostBasisCache();
}

/** Load inventory cost basis (per chain+token) from lots into Redis. Called on startup and when cache is refreshed. */
export async function loadInventoryCostBasisCache(): Promise<void> {
  const assets = await prisma.inventoryAsset.findMany({
    select: { id: true, chain: true, symbol: true },
  });
  const r = getRedis();
  const seen = new Set<string>();
  for (const asset of assets) {
    const key = `${asset.chain.toUpperCase()}:${asset.symbol.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const avg = await getAverageCostBasis(asset.id);
    if (avg != null) {
      const val = Number(avg);
      if (Number.isFinite(val)) {
        await r.set(costBasisKey(asset.chain, asset.symbol), String(val), "EX", VALIDATION_CACHE_TTL_SECONDS);
      }
    }
  }
}

/** Get cached cost basis (avg cost per token) for chain+token. Returns null if not in cache. */
export async function getCachedCostBasis(chain: string, token: string): Promise<number | null> {
  const r = getRedis();
  const raw = await r.get(costBasisKey(chain, token));
  if (raw == null) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Refresh cost basis cache for one chain+token (e.g. after poll worker updates inventory). */
export async function refreshCostBasisForChainToken(chain: string, token: string): Promise<void> {
  const asset = await prisma.inventoryAsset.findFirst({
    where: { chain: { equals: chain, mode: "insensitive" }, symbol: { equals: token, mode: "insensitive" } },
    select: { id: true, chain: true, symbol: true },
  });
  if (!asset) return;
  const avg = await getAverageCostBasis(asset.id);
  const r = getRedis();
  if (avg != null) {
    const val = Number(avg);
    if (Number.isFinite(val)) {
      await r.set(costBasisKey(asset.chain, asset.symbol), String(val), "EX", VALIDATION_CACHE_TTL_SECONDS);
    }
  } else {
    await r.del(costBasisKey(asset.chain, asset.symbol));
  }
}

/** Get cached providers from Redis. Returns null if not loaded. */
export async function getCachedProviders(): Promise<CachedProvider[] | null> {
  const r = getRedis();
  const raw = await r.get(VALIDATION_KEY_PROVIDERS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedProvider[];
  } catch {
    return null;
  }
}

/** Get cached chains from Redis. Returns null if not loaded. */
export async function getCachedChains(): Promise<CachedChain[] | null> {
  const r = getRedis();
  const raw = await r.get(VALIDATION_KEY_CHAINS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedChain[];
  } catch {
    return null;
  }
}

/** Get cached tokens from Redis. Returns null if not loaded. */
export async function getCachedTokens(): Promise<CachedToken[] | null> {
  const r = getRedis();
  const raw = await r.get(VALIDATION_KEY_TOKENS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedToken[];
  } catch {
    return null;
  }
}

/** Get cached platform fee from Redis. Required for fee validation; returns null if not loaded. */
export async function getCachedPlatformFee(): Promise<CachedPlatformFee | null> {
  const r = getRedis();
  const raw = await r.get(VALIDATION_KEY_PLATFORM_FEE);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as CachedPlatformFee;
    if (typeof o.baseFeePercent !== "number" || typeof o.fixedFee !== "number") return null;
    return o;
  } catch {
    return null;
  }
}

/** Get cached pricing quote. When chain+token provided, buy price = cost price from inventory (per token). */
export async function getCachedPricingQuote(chain?: string, token?: string): Promise<CachedPricingQuote | null> {
  const r = getRedis();
  const raw = await r.get(VALIDATION_KEY_PRICING_QUOTE);
  let global: CachedPricingQuote | null = null;
  if (raw) {
    try {
      const o = JSON.parse(raw) as CachedPricingQuote;
      if (
        typeof o.providerBuyPrice === "number" &&
        typeof o.providerSellPrice === "number" &&
        typeof o.volatility === "number"
      ) {
        global = o;
      }
    } catch {
      // ignore
    }
  }
  if (!global) {
    global = DEFAULT_PRICING_QUOTE;
  }
  if (chain && token) {
    const cost = await getCachedCostBasis(chain, token);
    const buyPrice = cost != null && Number.isFinite(cost) ? cost : global.providerBuyPrice;
    return {
      providerBuyPrice: buyPrice,
      providerSellPrice: global.providerSellPrice,
      volatility: global.volatility,
      costPrice: cost ?? undefined,
    };
  }
  return global;
}

/** Ensure cache is populated; load from DB if missing. If LOADED_AT exists but platform fee is missing (stale cache), reload. */
export async function ensureValidationCache(): Promise<void> {
  const r = getRedis();
  const loadedAtExists = await r.get(VALIDATION_KEY_LOADED_AT);
  const platformFeeRaw = await r.get(VALIDATION_KEY_PLATFORM_FEE);
  const cacheComplete = loadedAtExists && platformFeeRaw;
  if (!cacheComplete) await loadValidationCache();
}
