import { prisma } from "../lib/prisma.js";
import type { QuoteRouteStrategy } from "../../prisma/generated/prisma/client.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";

export type RouteStrategy = "same-chain-usdc" | "same-chain-native" | "base-cross-chain";

function normalizeTokenKey(tokenAddressOrSymbol: string): string {
  return tokenAddressOrSymbol.trim().toLowerCase();
}

function toDbStrategy(strategy: RouteStrategy): QuoteRouteStrategy {
  if (strategy === "same-chain-usdc") return "SAME_CHAIN_USDC";
  if (strategy === "same-chain-native") return "SAME_CHAIN_NATIVE";
  return "BASE_CROSS_CHAIN";
}

function fromDbStrategy(strategy: QuoteRouteStrategy): RouteStrategy {
  if (strategy === "SAME_CHAIN_USDC") return "same-chain-usdc";
  if (strategy === "SAME_CHAIN_NATIVE") return "same-chain-native";
  return "base-cross-chain";
}

export async function getPreferredRouteStrategies(params: {
  chainId: number;
  tokenAddressOrSymbol: string;
}): Promise<RouteStrategy[]> {
  const { chainId, tokenAddressOrSymbol } = params;
  const tokenKey = normalizeTokenKey(tokenAddressOrSymbol);
  const rows = await prisma.quoteRouteAttempt.findMany({
    where: {
      chainId,
      tokenKey,
      success: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      strategy: true,
      createdAt: true,
    },
  });
  const scoreByStrategy = new Map<RouteStrategy, { score: number; recentMs: number }>();
  for (const row of rows) {
    const key = fromDbStrategy(row.strategy);
    const current = scoreByStrategy.get(key) ?? { score: 0, recentMs: 0 };
    const nextScore = current.score + 1;
    const nextRecentMs = Math.max(current.recentMs, row.createdAt.getTime());
    scoreByStrategy.set(key, { score: nextScore, recentMs: nextRecentMs });
  }
  return [...scoreByStrategy.entries()]
    .sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      return b[1].recentMs - a[1].recentMs;
    })
    .map(([strategy]) => strategy);
}

export async function recordQuoteRouteAttempt(params: {
  action: "buy" | "sell";
  chainId: number;
  countryCode?: string;
  tokenAddressOrSymbol: string;
  strategy: RouteStrategy;
  provider?: string;
  success: boolean;
  errorCode?: string;
  errorReason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const {
    action,
    chainId,
    countryCode,
    tokenAddressOrSymbol,
    strategy,
    provider,
    success,
    errorCode,
    errorReason,
    metadata,
  } = params;
  const tokenKey = normalizeTokenKey(tokenAddressOrSymbol);
  await prisma.quoteRouteAttempt.create({
    data: {
      action,
      chainId,
      countryCode: countryCode?.trim().toUpperCase() || null,
      tokenKey,
      strategy: toDbStrategy(strategy),
      provider: provider?.trim() || null,
      success,
      errorCode: errorCode?.trim() || null,
      errorReason: errorReason?.trim() || null,
      ...(metadata != null
        ? { metadata: metadata as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
}

export async function listRecentQuoteRouteAttempts(params?: {
  limit?: number;
  chainId?: number;
  tokenKey?: string;
  countryCode?: string;
  provider?: string;
}): Promise<
  Array<{
    id: string;
    createdAt: string;
    action: string;
    chainId: number;
    countryCode: string | null;
    tokenKey: string;
    strategy: RouteStrategy;
    provider: string | null;
    success: boolean;
    errorCode: string | null;
    errorReason: string | null;
  }>
> {
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
  const rows = await prisma.quoteRouteAttempt.findMany({
    where: {
      ...(params?.chainId != null ? { chainId: params.chainId } : {}),
      ...(params?.tokenKey?.trim()
        ? { tokenKey: normalizeTokenKey(params.tokenKey) }
        : {}),
      ...(params?.countryCode?.trim()
        ? { countryCode: params.countryCode.trim().toUpperCase() }
        : {}),
      ...(params?.provider?.trim() ? { provider: params.provider.trim() } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    chainId: row.chainId,
    countryCode: row.countryCode,
    tokenKey: row.tokenKey,
    strategy: fromDbStrategy(row.strategy),
    provider: row.provider,
    success: row.success,
    errorCode: row.errorCode,
    errorReason: row.errorReason,
  }));
}

