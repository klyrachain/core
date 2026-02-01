/**
 * Order validation: lightweight, fast. Uses Redis cache only (no DB in hot path).
 * Validates: providers, identifiers, chains, tokens, KLYRA balance, swap route.
 * On success: caller submits to pool. On failure: store in FailedOrderValidation + optional Redis list.
 */

import { validateProviderPayload, type ProviderPayload } from "./provider.server.js";
import {
  getCachedProviders,
  getCachedChains,
  getCachedTokens,
  getCachedPlatformFee,
  getCachedPricingQuote,
  ensureValidationCache,
} from "./validation-cache.service.js";
import { quoteOnRamp, quoteOffRamp, effectiveBaseProfit } from "../lib/pricing-engine.js";
import { getBalance } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import {
  VALIDATION_FAILED_LIST_KEY,
  VALIDATION_FAILED_LIST_TTL_SECONDS,
} from "../lib/redis.js";
import { getRedis } from "../lib/redis.js";

export type OrderValidationInput = {
  action: "buy" | "sell" | "request" | "claim";
  fromIdentifier?: string | null;
  fromType?: string | null;
  fromUserId?: string | null;
  toIdentifier?: string | null;
  toType?: string | null;
  toUserId?: string | null;
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
  f_chain: string;
  t_chain: string;
  f_token: string;
  t_token: string;
  f_provider: string;
  t_provider: string;
  requestId?: string | null;
};

export type OrderValidationResult =
  | { valid: true }
  | { valid: false; error: string; code: string };

/** Lightweight payload summary for failed validation storage (no PII). */
export function payloadSummary(input: OrderValidationInput): Record<string, unknown> {
  return {
    action: input.action,
    f_chain: input.f_chain,
    t_chain: input.t_chain,
    f_token: input.f_token,
    t_token: input.t_token,
    f_amount: input.f_amount,
    t_amount: input.t_amount,
    f_provider: input.f_provider,
    t_provider: input.t_provider,
  };
}

/** Validate order. Uses Redis cache only; call ensureValidationCache() at startup / 24h. */
export async function validateOrder(input: OrderValidationInput): Promise<OrderValidationResult> {
  await ensureValidationCache();

  const providerPayload: ProviderPayload = {
    action: input.action,
    fromIdentifier: input.fromIdentifier,
    fromType: (input.fromType ?? null) as ProviderPayload["fromType"],
    toIdentifier: input.toIdentifier,
    toType: (input.toType ?? null) as ProviderPayload["toType"],
    f_provider: input.f_provider as ProviderPayload["f_provider"],
    t_provider: input.t_provider as ProviderPayload["t_provider"],
    f_chain: input.f_chain,
    t_chain: input.t_chain,
    f_token: input.f_token,
    t_token: input.t_token,
  };

  const providerResult = validateProviderPayload(providerPayload);
  if (!providerResult.valid) {
    return {
      valid: false,
      error: providerResult.error,
      code: providerResult.code ?? "PROVIDER_VALIDATION_FAILED",
    };
  }

  const providers = await getCachedProviders();
  const chains = await getCachedChains();
  const tokens = await getCachedTokens();

  if (!providers || !chains || !tokens) {
    return {
      valid: false,
      error: "Validation cache not ready",
      code: "CACHE_NOT_READY",
    };
  }

  const fProvider = providers.find((p) => p.code === input.f_provider);
  const tProvider = providers.find((p) => p.code === input.t_provider);

  if (!fProvider) {
    return { valid: false, error: `Unknown or disabled f_provider: ${input.f_provider}`, code: "INVALID_F_PROVIDER" };
  }
  if (!tProvider) {
    return { valid: false, error: `Unknown or disabled t_provider: ${input.t_provider}`, code: "INVALID_T_PROVIDER" };
  }
  if (!fProvider.enabled) {
    return { valid: false, error: `f_provider ${input.f_provider} is disabled`, code: "F_PROVIDER_DISABLED" };
  }
  if (!tProvider.enabled) {
    return { valid: false, error: `t_provider ${input.t_provider} is disabled`, code: "T_PROVIDER_DISABLED" };
  }

  const fChainNorm = input.f_chain.trim().toUpperCase();
  const tChainNorm = input.t_chain.trim().toUpperCase();
  const fChainRecord = chains.find((c) => c.code === fChainNorm);
  const tChainRecord = chains.find((c) => c.code === tChainNorm);

  if (!fChainRecord) {
    return { valid: false, error: `Unsupported f_chain: ${input.f_chain}`, code: "UNSUPPORTED_F_CHAIN" };
  }
  if (!tChainRecord) {
    return { valid: false, error: `Unsupported t_chain: ${input.t_chain}`, code: "UNSUPPORTED_T_CHAIN" };
  }

  const fTokenNorm = input.f_token.trim().toUpperCase();
  const tTokenNorm = input.t_token.trim().toUpperCase();
  const fTokenRecord = tokens.find(
    (t) => t.chainId === fChainRecord.chainId && t.symbol.toUpperCase() === fTokenNorm
  );
  const tTokenRecord = tokens.find(
    (t) => t.chainId === tChainRecord.chainId && t.symbol.toUpperCase() === tTokenNorm
  );

  if (!fTokenRecord) {
    return {
      valid: false,
      error: `Token ${input.f_token} not supported on chain ${input.f_chain}`,
      code: "UNSUPPORTED_F_TOKEN",
    };
  }
  if (!tTokenRecord) {
    return {
      valid: false,
      error: `Token ${input.t_token} not supported on chain ${input.t_chain}`,
      code: "UNSUPPORTED_T_TOKEN",
    };
  }

  if (input.t_provider === "KLYRA") {
    const balance = await getBalance(input.t_chain, input.t_token);
    const available = balance?.amount ? parseFloat(balance.amount) : 0;
    if (available < input.t_amount) {
      return {
        valid: false,
        error: `Insufficient KLYRA balance: ${input.t_token} on ${input.t_chain} has ${available}, required ${input.t_amount}`,
        code: "INSUFFICIENT_FUNDS",
      };
    }
  }

  if (input.f_price <= 0 || input.t_price <= 0) {
    return {
      valid: false,
      error: "f_price and t_price must be positive",
      code: "INVALID_PRICE",
    };
  }

  const platformFee = await getCachedPlatformFee();
  if (!platformFee) {
    return {
      valid: false,
      error: "Platform fee not available; cannot validate order",
      code: "FEE_UNAVAILABLE",
    };
  }

  if (input.action === "buy" || input.action === "sell") {
    const baseProfitOnRamp = effectiveBaseProfit(platformFee.baseFeePercent, tProvider.fee ?? 0);
    const baseProfitOffRamp = effectiveBaseProfit(platformFee.baseFeePercent, fProvider.fee ?? 0);
    const PRICE_TOLERANCE = 0.02;

    if (input.action === "buy") {
      const quote = await getCachedPricingQuote(input.t_chain, input.t_token);
      if (!quote) {
        return {
          valid: false,
          error: "Pricing quote not available; cannot validate buy/sell",
          code: "QUOTE_UNAVAILABLE",
        };
      }
      const expected = quoteOnRamp({
        providerPrice: quote.providerBuyPrice,
        avgBuyPrice: quote.costPrice,
        minSellingPrice: quote.costPrice,
        baseProfit: baseProfitOnRamp,
        volatility: quote.volatility,
      });
      const expectedPrice = expected.pricePerToken;
      const orderPrice = input.t_price;
      const ratio = expectedPrice > 0 ? orderPrice / expectedPrice : 0;
      if (ratio < 1 - PRICE_TOLERANCE || ratio > 1 + PRICE_TOLERANCE) {
        return {
          valid: false,
          error: `Order t_price (${orderPrice}) is outside allowed range for on-ramp (expected ~${expectedPrice.toFixed(6)} per token, ±${PRICE_TOLERANCE * 100}%)`,
          code: "PRICE_OUT_OF_TOLERANCE",
        };
      }
    }

    if (input.action === "sell") {
      const quoteF = await getCachedPricingQuote(input.f_chain, input.f_token);
      const quoteT = await getCachedPricingQuote(input.t_chain, input.t_token);
      if (!quoteF || !quoteT) {
        return {
          valid: false,
          error: "Pricing quote not available; cannot validate sell",
          code: "QUOTE_UNAVAILABLE",
        };
      }
      const expectedOffRamp = quoteOffRamp({
        providerPrice: quoteF.providerSellPrice,
        baseProfit: baseProfitOffRamp,
        volatility: quoteF.volatility,
      });
      const expectedFPrice = expectedOffRamp.pricePerToken;
      const orderFPrice = input.f_price;
      const ratioF = expectedFPrice > 0 ? orderFPrice / expectedFPrice : 0;
      if (ratioF < 1 - PRICE_TOLERANCE || ratioF > 1 + PRICE_TOLERANCE) {
        return {
          valid: false,
          error: `Order f_price (${orderFPrice}) is outside allowed range for off-ramp (expected ~${expectedFPrice.toFixed(6)} per token, ±${PRICE_TOLERANCE * 100}%)`,
          code: "PRICE_OUT_OF_TOLERANCE",
        };
      }
      const expectedOnRamp = quoteOnRamp({
        providerPrice: quoteT.providerBuyPrice,
        avgBuyPrice: quoteT.costPrice,
        minSellingPrice: quoteT.costPrice,
        baseProfit: baseProfitOnRamp,
        volatility: quoteT.volatility,
      });
      const expectedTPrice = expectedOnRamp.pricePerToken;
      const orderTPrice = input.t_price;
      const ratioT = expectedTPrice > 0 ? orderTPrice / expectedTPrice : 0;
      if (ratioT < 1 - PRICE_TOLERANCE || ratioT > 1 + PRICE_TOLERANCE) {
        return {
          valid: false,
          error: `Order t_price (${orderTPrice}) is outside allowed range for on-ramp (expected ~${expectedTPrice.toFixed(6)} per token, ±${PRICE_TOLERANCE * 100}%)`,
          code: "PRICE_OUT_OF_TOLERANCE",
        };
      }
    }
  }

  return { valid: true };
}

/** Store failed validation in DB (lightweight) and optionally in Redis list for recent view. */
export async function storeFailedValidation(
  input: OrderValidationInput,
  result: { error: string; code: string }
): Promise<void> {
  const payload = payloadSummary(input);
  await prisma.failedOrderValidation.create({
    data: {
      reason: result.error,
      code: result.code,
      payload: payload as object,
      requestId: input.requestId ?? null,
    },
  });

  const r = getRedis();
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    code: result.code,
    error: result.error,
    payload,
  });
  await r.lpush(VALIDATION_FAILED_LIST_KEY, entry);
  await r.ltrim(VALIDATION_FAILED_LIST_KEY, 0, 999);
  await r.expire(VALIDATION_FAILED_LIST_KEY, VALIDATION_FAILED_LIST_TTL_SECONDS);
}
