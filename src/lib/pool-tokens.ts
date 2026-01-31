/**
 * Liquidity pool tokens: Base/Ethereum USDC and ETH.
 * Used for direct Fonbnk quotes (when supported) and as intermediate for onramp→swap.
 * Fonbnk expects NETWORK_ASSET (chain + token, e.g. BASE_USDC, POLYGON_USDC, ETHEREUM_NATIVE).
 * See: https://docs.fonbnk.com/supported-countries-and-cryptocurrencies
 * Note: BASE_ETH is not in Fonbnk's supported list (only BASE_USDC for Base); Base ETH quotes use intermediate + swap.
 */

import type { PoolToken } from "./onramp-quote.types.js";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Chain IDs. */
export const CHAIN_ID_BASE = 8453;
export const CHAIN_ID_ETHEREUM = 1;

/** Pool tokens we hold. fonbnkCode is NETWORK_ASSET; only codes in Fonbnk's supported list get direct quotes. */
export const POOL_TOKENS: PoolToken[] = [
  {
    chainId: CHAIN_ID_BASE,
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    fonbnkCode: "BASE_USDC",
  },
  {
    chainId: CHAIN_ID_BASE,
    symbol: "ETH",
    address: NATIVE,
    fonbnkCode: "BASE_ETH",
  },
  {
    chainId: CHAIN_ID_ETHEREUM,
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    fonbnkCode: "ETHEREUM_USDC",
  },
  {
    chainId: CHAIN_ID_ETHEREUM,
    symbol: "ETH",
    address: NATIVE,
    fonbnkCode: "ETHEREUM_NATIVE",
  },
];

/** Decimals per symbol for pool tokens. */
export const POOL_TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  ETH: 18,
};

/**
 * Find pool token by chain and token (symbol or address, case-insensitive).
 */
export function findPoolToken(chainId: number, token: string): PoolToken | null {
  const t = token.trim();
  const lower = t.toLowerCase();
  for (const p of POOL_TOKENS) {
    if (p.chainId !== chainId) continue;
    if (p.symbol.toUpperCase() === t.toUpperCase()) return p;
    if (p.address.toLowerCase() === lower) return p;
  }
  return null;
}

/**
 * Prefer same-chain USDC, then same-chain ETH, then Base USDC.
 */
export function getIntermediatePoolToken(requestChainId: number): PoolToken {
  const sameChainUsdc = POOL_TOKENS.find(
    (p) => p.chainId === requestChainId && p.symbol === "USDC"
  );
  if (sameChainUsdc) return sameChainUsdc;
  const sameChainEth = POOL_TOKENS.find(
    (p) => p.chainId === requestChainId && p.symbol === "ETH"
  );
  if (sameChainEth) return sameChainEth;
  const baseUsdc = POOL_TOKENS.find(
    (p) => p.chainId === CHAIN_ID_BASE && p.symbol === "USDC"
  );
  return baseUsdc ?? POOL_TOKENS[0];
}

export function getPoolTokenDecimals(symbol: string): number {
  return POOL_TOKEN_DECIMALS[symbol] ?? 18;
}
