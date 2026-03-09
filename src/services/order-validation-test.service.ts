/**
 * Testnet-only order validation. Used by /api/test/offramp/order and /api/test/onramp/order.
 * Validates against DB (chains + supported tokens) for allowed testnet chains only.
 * Main webhook/order uses order-validation.service (mainnet); test endpoints use this (testnet).
 */

import { validateProviderPayload, type ProviderPayload } from "./provider.server.js";
import { prisma } from "../lib/prisma.js";
import type { OrderValidationInput, OrderValidationResult } from "./order-validation.service.js";

/** Testnet chains allowed for test endpoints only (by display name). */
const TESTNET_CHAIN_CODES = new Set(["BASE SEPOLIA"]);
/** Testnet chain IDs (e.g. Base Sepolia 84532). Token validation only accepts tokens on these chains when running test endpoints. */
const TESTNET_CHAIN_IDS = new Set([84532n]);
/** Fiat/offchain chains for payout (offramp) or pay-in (onramp). */
const FIAT_CHAIN_CODES = new Set(["MOMO", "BANK", "CARD"]);

function normalizeChainCode(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Validate order for testnet flows only. Uses DB for chain/token lookup (no validation cache).
 * Offramp: f_chain must be testnet, t_chain must be fiat. Onramp: f_chain fiat, t_chain testnet.
 */
export async function validateOrderForTestnet(input: OrderValidationInput): Promise<OrderValidationResult> {
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

  const fChainNorm = normalizeChainCode(input.f_chain);
  const tChainNorm = normalizeChainCode(input.t_chain);

  if (input.action === "sell") {
    if (!TESTNET_CHAIN_CODES.has(fChainNorm)) {
      return {
        valid: false,
        error: `Test offramp only allows testnet f_chain (e.g. BASE SEPOLIA). Got: ${input.f_chain}`,
        code: "UNSUPPORTED_F_CHAIN",
      };
    }
    if (!FIAT_CHAIN_CODES.has(tChainNorm)) {
      return {
        valid: false,
        error: `Test offramp requires fiat t_chain (MOMO/BANK). Got: ${input.t_chain}`,
        code: "UNSUPPORTED_T_CHAIN",
      };
    }
  } else if (input.action === "buy") {
    if (!FIAT_CHAIN_CODES.has(fChainNorm)) {
      return {
        valid: false,
        error: `Test onramp requires fiat f_chain (MOMO/BANK). Got: ${input.f_chain}`,
        code: "UNSUPPORTED_F_CHAIN",
      };
    }
    if (!TESTNET_CHAIN_CODES.has(tChainNorm)) {
      return {
        valid: false,
        error: `Test onramp only allows testnet t_chain (e.g. BASE SEPOLIA). Got: ${input.t_chain}`,
        code: "UNSUPPORTED_T_CHAIN",
      };
    }
  } else {
    return { valid: false, error: "Test endpoints support only buy (onramp) or sell (offramp)", code: "INVALID_ACTION" };
  }

  const chains = await prisma.chain.findMany({ select: { chainId: true, name: true } });
  const chainCodeToId = new Map(chains.map((c) => [normalizeChainCode(c.name), c.chainId]));

  const fChainId = chainCodeToId.get(fChainNorm);
  const tChainId = chainCodeToId.get(tChainNorm);

  if (fChainId == null && !FIAT_CHAIN_CODES.has(fChainNorm)) {
    return { valid: false, error: `Chain not found in DB: ${input.f_chain}`, code: "UNSUPPORTED_F_CHAIN" };
  }
  if (tChainId == null && !FIAT_CHAIN_CODES.has(tChainNorm)) {
    return { valid: false, error: `Chain not found in DB: ${input.t_chain}`, code: "UNSUPPORTED_T_CHAIN" };
  }

  if (input.action === "sell" && fChainId != null && !TESTNET_CHAIN_IDS.has(fChainId)) {
    return { valid: false, error: `Test offramp only allows testnet f_chain (chainId in ${[...TESTNET_CHAIN_IDS].join(", ")}). Got: ${input.f_chain}`, code: "UNSUPPORTED_F_CHAIN" };
  }
  if (input.action === "buy" && tChainId != null && !TESTNET_CHAIN_IDS.has(tChainId)) {
    return { valid: false, error: `Test onramp only allows testnet t_chain (chainId in ${[...TESTNET_CHAIN_IDS].join(", ")}). Got: ${input.t_chain}`, code: "UNSUPPORTED_T_CHAIN" };
  }

  const tokens = await prisma.supportedToken.findMany({
    select: { chainId: true, symbol: true },
  });

  const tokenExists = (chainId: bigint | undefined, symbol: string): boolean => {
    if (chainId == null) return true;
    const sym = symbol.trim().toUpperCase();
    return tokens.some((t) => t.chainId === chainId && t.symbol.toUpperCase() === sym);
  };

  if (fChainId != null && !tokenExists(fChainId, input.f_token)) {
    return {
      valid: false,
      error: `Token ${input.f_token} not supported on chain ${input.f_chain}`,
      code: "UNSUPPORTED_F_TOKEN",
    };
  }
  if (tChainId != null && !tokenExists(tChainId, input.t_token)) {
    return {
      valid: false,
      error: `Token ${input.t_token} not supported on chain ${input.t_chain}`,
      code: "UNSUPPORTED_T_TOKEN",
    };
  }

  if (input.f_price <= 0 || input.t_price <= 0) {
    return {
      valid: false,
      error: "f_price and t_price must be positive",
      code: "INVALID_PRICE",
    };
  }

  if (!Number.isFinite(input.f_amount) || input.f_amount <= 0 || !Number.isFinite(input.t_amount) || input.t_amount <= 0) {
    return {
      valid: false,
      error: "f_amount and t_amount must be positive numbers",
      code: "INVALID_AMOUNT",
    };
  }

  return { valid: true };
}
