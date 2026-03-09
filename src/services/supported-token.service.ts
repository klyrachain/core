/**
 * Supported chains and tokens from DB (replaces hardcoded pool-tokens for quote/onramp).
 * Used for pool-token lookup, intermediate token selection, and public/admin chains/tokens API.
 */

import { prisma } from "../lib/prisma.js";
import type { PoolToken } from "../lib/onramp-quote.types.js";
import { isFonbnkSupportedPayoutCode } from "./fonbnk.service.js";

const CHAIN_ID_BASE = 8453;

/** Shape of supported token row from DB (chainId is BigInt in DB; we use number in PoolToken for quote/pool). */
interface SupportedTokenRow {
  chainId: bigint;
  tokenAddress: string;
  symbol: string;
  fonbnkCode: string | null;
  decimals: number;
}

function rowToPoolToken(r: SupportedTokenRow): PoolToken {
  const chainIdNum = Number(r.chainId);
  return {
    chainId: chainIdNum,
    symbol: r.symbol,
    address: r.tokenAddress,
    fonbnkCode: r.fonbnkCode ?? `${r.chainId}_${r.symbol}`,
    decimals: r.decimals,
  };
}

/** Load all supported tokens as PoolToken[]. */
export async function getPoolTokensFromDb(): Promise<PoolToken[]> {
  const rows = await prisma.supportedToken.findMany({
    orderBy: [{ chainId: "asc" }, { symbol: "asc" }],
    select: { chainId: true, tokenAddress: true, symbol: true, fonbnkCode: true, decimals: true },
  });
  return rows.map((r: SupportedTokenRow) => rowToPoolToken({ ...r, fonbnkCode: r.fonbnkCode ?? null }));
}

/**
 * Find supported token by chain and token (symbol or address, case-insensitive).
 */
export async function findPoolTokenFromDb(chainId: number, token: string): Promise<PoolToken | null> {
  const t = token.trim();
  const lower = t.toLowerCase();
  const rows = await prisma.supportedToken.findMany({
    where: { chainId: BigInt(chainId) },
    select: { chainId: true, tokenAddress: true, symbol: true, fonbnkCode: true, decimals: true },
  }) as SupportedTokenRow[];
  for (const r of rows) {
    if (r.symbol.toUpperCase() === t.toUpperCase()) return rowToPoolToken({ ...r, fonbnkCode: r.fonbnkCode ?? null });
    if (r.tokenAddress.toLowerCase() === lower) return rowToPoolToken({ ...r, fonbnkCode: r.fonbnkCode ?? null });
  }
  return null;
}

/**
 * Prefer same-chain USDC, then same-chain ETH, then Base USDC.
 */
export async function getIntermediatePoolTokenFromDb(requestChainId: number): Promise<PoolToken> {
  const tokens = await getPoolTokensFromDb();
  const sameChainUsdc = tokens.find((p) => p.chainId === requestChainId && p.symbol === "USDC");
  if (sameChainUsdc) return sameChainUsdc;
  const sameChainEth = tokens.find((p) => p.chainId === requestChainId && p.symbol === "ETH");
  if (sameChainEth) return sameChainEth;
  const baseUsdc = tokens.find((p) => p.chainId === CHAIN_ID_BASE && p.symbol === "USDC");
  return baseUsdc ?? tokens[0];
}

/**
 * Get decimals for a token symbol (first match in supported tokens). Default 18.
 */
export async function getPoolTokenDecimalsFromDb(symbol: string): Promise<number> {
  const row = await prisma.supportedToken.findFirst({
    where: { symbol: symbol.trim() },
    select: { decimals: true },
  }) as { decimals: number } | null;
  return row?.decimals ?? 18;
}

/**
 * Whether this pool token can get a direct Fonbnk quote (Fonbnk supports its fonbnkCode).
 */
export function useDirectFonbnkForPoolToken(pool: PoolToken): boolean {
  return isFonbnkSupportedPayoutCode(pool.fonbnkCode);
}
