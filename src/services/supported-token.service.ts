/**
 * Supported chains and tokens from DB (replaces hardcoded pool-tokens for quote/onramp).
 * Used for pool-token lookup, intermediate token selection, and public/admin chains/tokens API.
 */

import { prisma } from "../lib/prisma.js";
import type { PoolToken } from "../lib/onramp-quote.types.js";
import {
  inferFonbnkCodeFromChainAndSymbol,
  isFonbnkSupportedPayoutCodeResolved,
} from "./fonbnk.service.js";

export const CHAIN_ID_BASE = 8453;
const NATIVE_TOKEN_SYMBOLS = new Set([
  "ETH",
  "BNB",
  "MATIC",
  "POL",
  "CELO",
  "AVAX",
  "FTM",
  "SOL",
  "BTC",
  "XLM",
  "SUI",
]);

/** Shape of supported token row from DB (chainId is BigInt in DB; we use number in PoolToken for quote/pool). */
interface SupportedTokenRow {
  chainId: bigint;
  tokenAddress: string;
  symbol: string;
  fonbnkCode: string | null;
  decimals: number;
}

function resolveFonbnkCodeForPool(r: SupportedTokenRow): string {
  const explicit = r.fonbnkCode?.trim();
  if (explicit) return explicit;
  const inferred = inferFonbnkCodeFromChainAndSymbol(Number(r.chainId), r.symbol);
  if (inferred) return inferred;
  return `${r.chainId}_${r.symbol}`;
}

function rowToPoolToken(r: SupportedTokenRow): PoolToken {
  const chainIdNum = Number(r.chainId);
  return {
    chainId: chainIdNum,
    symbol: r.symbol,
    address: r.tokenAddress,
    fonbnkCode: resolveFonbnkCodeForPool(r),
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
 * Prefer same-chain USDC, then same-chain native, then Base USDC.
 */
export async function getIntermediatePoolTokenFromDb(requestChainId: number): Promise<PoolToken> {
  const ordered = await getIntermediatePoolTokenCandidatesFromDb(requestChainId);
  if (ordered.length > 0) return ordered[0];
  const tokens = await getPoolTokensFromDb();
  return tokens[0];
}

function isLikelyNativePoolToken(pool: PoolToken): boolean {
  const normalizedAddress = pool.address.trim().toLowerCase();
  if (
    normalizedAddress === "native" ||
    normalizedAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return true;
  }
  if (pool.fonbnkCode.toUpperCase().endsWith("_NATIVE")) return true;
  return NATIVE_TOKEN_SYMBOLS.has(pool.symbol.toUpperCase());
}

export async function getIntermediatePoolTokenCandidatesFromDb(
  requestChainId: number
): Promise<PoolToken[]> {
  const tokens = await getPoolTokensFromDb();
  const ordered: PoolToken[] = [];
  const seen = new Set<string>();
  const pushUnique = async (pool: PoolToken | undefined): Promise<void> => {
    if (!pool || !(await useDirectFonbnkForPoolToken(pool))) return;
    const key = `${pool.chainId}|${pool.address.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(pool);
  };

  const sameChainUsdc = tokens.find(
    (pool) => pool.chainId === requestChainId && pool.symbol.toUpperCase() === "USDC"
  );
  await pushUnique(sameChainUsdc);

  const sameChainNative = tokens.find(
    (pool) => pool.chainId === requestChainId && isLikelyNativePoolToken(pool)
  );
  await pushUnique(sameChainNative);

  const baseUsdc = tokens.find(
    (pool) => pool.chainId === CHAIN_ID_BASE && pool.symbol.toUpperCase() === "USDC"
  );
  await pushUnique(baseUsdc);

  return ordered;
}

/** Base mainnet USDC pool row (Fonbnk BASE_USDC when configured). Used as cross-chain swap leg fallback. */
export async function getBaseUsdcPoolTokenFromDb(): Promise<PoolToken | null> {
  const tokens = await getPoolTokensFromDb();
  return tokens.find((p) => p.chainId === CHAIN_ID_BASE && p.symbol === "USDC") ?? null;
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
export async function useDirectFonbnkForPoolToken(pool: PoolToken): Promise<boolean> {
  return isFonbnkSupportedPayoutCodeResolved(pool.fonbnkCode);
}
