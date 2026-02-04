/**
 * Platform analytics: overview and breakdown by trading pair.
 * Uses realized revenue (fee × USD price at tx time) to avoid exchange-rate normalization issues.
 */

import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const COMPLETED_STATUS = "COMPLETED" as const;
const USD_STABLECOINS = ["USDC", "USDT", "USD"];

function toNum(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(String(v)) || 0;
}

function isStablecoin(token: string): boolean {
  return USD_STABLECOINS.includes(String(token).toUpperCase());
}

/** Classify pair direction for reporting: ONRAMP (fiat→crypto), OFF_RAMP (crypto→fiat), SWAP (crypto↔crypto). */
function pairType(fToken: string, tToken: string): "ONRAMP" | "OFF_RAMP" | "SWAP" {
  const fStable = isStablecoin(fToken);
  const tStable = isStablecoin(tToken);
  if (!fStable && tStable) return "ONRAMP";   // e.g. GHS → USDC
  if (fStable && !tStable) return "OFF_RAMP"; // e.g. USDC → GHS
  return "SWAP";
}

export type PlatformOverviewPair = {
  symbol: string;
  type: "ONRAMP" | "OFF_RAMP" | "SWAP";
  volumeUsd: string;
  fees: { amount: string; currency: string };
  realizedRevenueUsd: string;
  count: number;
};

export type PlatformOverviewResult = {
  overview: {
    grossVolumeUsd: string;
    realizedRevenueUsd: string;
    totalTxCount: number;
  };
  pairs: PlatformOverviewPair[];
};

/**
 * Aggregate completed transactions by trading pair with realized revenue (USD at tx time).
 * Optional date range: ISO date strings or Date; inclusive [startDate, endDate].
 */
export async function getPlatformOverview(options?: {
  startDate?: Date | string;
  endDate?: Date | string;
}): Promise<PlatformOverviewResult> {
  const where: Prisma.TransactionWhereInput = {
    status: COMPLETED_STATUS,
  };
  if (options?.startDate != null || options?.endDate != null) {
    const range: { gte?: Date; lte?: Date } = {};
    if (options.startDate != null) {
      const d = typeof options.startDate === "string" ? new Date(options.startDate) : options.startDate;
      range.gte = new Date(d);
      range.gte.setUTCHours(0, 0, 0, 0);
    }
    if (options.endDate != null) {
      const d = typeof options.endDate === "string" ? new Date(options.endDate) : options.endDate;
      range.lte = new Date(d);
      range.lte.setUTCHours(23, 59, 59, 999);
    }
    where.createdAt = range;
  }

  const txns = await prisma.transaction.findMany({
    where,
    select: {
      type: true,
      f_token: true,
      t_token: true,
      f_amount: true,
      t_amount: true,
      f_tokenPriceUsd: true,
      t_tokenPriceUsd: true,
      fee: true,
      feeInUsd: true,
    },
  });

  const pairKey = (f: string, t: string) => `${f}/${t}`;
  const byPair = new Map<
    string,
    {
      volumeUsd: number;
      feeAmountByCurrency: number;
      feeCurrency: string;
      realizedRevenueUsd: number;
      count: number;
    }
  >();

  let totalVolumeUsd = 0;
  let totalRealizedRevenueUsd = 0;

  for (const tx of txns) {
    const symbol = pairKey(tx.f_token, tx.t_token);
    const type = tx.type;
    const fAmount = toNum(tx.f_amount);
    const tAmount = toNum(tx.t_amount);
    const fPriceUsd = toNum(tx.f_tokenPriceUsd);
    const tPriceUsd = toNum(tx.t_tokenPriceUsd);

    const sideF = fAmount * fPriceUsd;
    const sideT = tAmount * tPriceUsd;
    const volumeUsd = sideF > 0 && sideT > 0 ? (sideF + sideT) / 2 : sideF + sideT;

    const feeAmount = toNum(tx.fee);
    const feeInUsd = toNum(tx.feeInUsd);
    const realizedUsd = feeInUsd > 0 ? feeInUsd : feeAmount * (type === "SELL" ? tPriceUsd : fPriceUsd);
    const currency = type === "SELL" ? tx.t_token : tx.f_token;

    if (!byPair.has(symbol)) {
      byPair.set(symbol, {
        volumeUsd: 0,
        feeAmountByCurrency: 0,
        feeCurrency: currency,
        realizedRevenueUsd: 0,
        count: 0,
      });
    }
    const row = byPair.get(symbol)!;
    row.volumeUsd += volumeUsd;
    row.feeAmountByCurrency += feeAmount;
    row.feeCurrency = currency;
    row.realizedRevenueUsd += realizedUsd;
    row.count += 1;

    totalVolumeUsd += volumeUsd;
    totalRealizedRevenueUsd += realizedUsd;
  }

  const pairs: PlatformOverviewPair[] = [];
  for (const [symbol, row] of byPair.entries()) {
    const [fToken, tToken] = symbol.split("/");
    pairs.push({
      symbol,
      type: pairType(fToken, tToken),
      volumeUsd: row.volumeUsd.toFixed(2),
      fees: {
        amount: String(Math.round(row.feeAmountByCurrency * 1e8) / 1e8),
        currency: row.feeCurrency,
      },
      realizedRevenueUsd: row.realizedRevenueUsd.toFixed(2),
      count: row.count,
    });
  }

  pairs.sort((a, b) => parseFloat(b.volumeUsd) - parseFloat(a.volumeUsd));

  return {
    overview: {
      grossVolumeUsd: totalVolumeUsd.toFixed(2),
      realizedRevenueUsd: totalRealizedRevenueUsd.toFixed(2),
      totalTxCount: txns.length,
    },
    pairs,
  };
}
