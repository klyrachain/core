/**
 * Tenant-scoped metrics for GET /api/v1/merchant/summary (aligned with platform overview math).
 */
import type { MerchantEnvironment, Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "./prisma.js";
import { getAccumulatedFees } from "../routes/api/connect.js";

const COMPLETED = "COMPLETED";

export function transactionVolumeUsdApprox(t: {
  f_amount: { toString(): string };
  t_amount: { toString(): string };
  f_tokenPriceUsd: { toString(): string } | null;
  t_tokenPriceUsd: { toString(): string } | null;
}): number {
  const sideF =
    Number(t.f_amount.toString()) * Number((t.f_tokenPriceUsd ?? 0).toString() || 0);
  const sideT =
    Number(t.t_amount.toString()) * Number((t.t_tokenPriceUsd ?? 0).toString() || 0);
  if (sideF > 0 && sideT > 0) return (sideF + sideT) / 2;
  return sideF + sideT;
}

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export type MerchantSummaryResult = {
  periodDays: number;
  seriesDays: number;
  periodFrom: string;
  periodTo: string;
  business: {
    id: string;
    name: string;
    slug: string;
    kybStatus: string;
  };
  transactions: {
    totalAllTime: number;
    inPeriod: number;
    byStatusAllTime: Record<string, number>;
    byStatusInPeriod: Record<string, number>;
    last24hCount: number;
    last7dCount: number;
    volumeUsdInPeriod: number;
    completedCountInPeriod: number;
    platformFeesUsdInPeriod: number;
    merchantFeesUsdInPeriod: number;
  };
  fees: {
    byCurrency: Record<string, string>;
    totalConvertedUsd: number;
  };
  settlements: {
    countByStatus: Record<string, number>;
    amountSumByCurrencyAndStatus: Array<{
      currency: string;
      status: string;
      sum: string;
    }>;
  };
  series: Array<{
    date: string;
    transactionCount: number;
    completedVolumeUsd: number;
  }>;
  /** Checkout payment-link attribution (PaymentLink rows). */
  paymentLinks: {
    /** USD volume from COMPLETED txs tied to a payment link in the period. */
    volumeUsdInPeriod: number;
    /** COMPLETED txs in period that reference a payment link. */
    completedTxWithLinkCount: number;
    /** Distinct payment links with ≥1 COMPLETED tx in the period. */
    distinctLinksUsedInPeriod: number;
    /** Total payment link definitions for the business (all statuses). */
    totalPaymentLinks: number;
  };
};

export async function buildMerchantSummary(
  businessId: string,
  options: { periodDays: number; seriesDays: number; environment: MerchantEnvironment }
): Promise<MerchantSummaryResult> {
  const now = new Date();
  const periodDays = Math.min(365, Math.max(1, options.periodDays));
  const seriesDays = Math.min(90, Math.max(1, options.seriesDays));
  const periodFrom = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, slug: true, kybStatus: true },
  });
  if (!business) {
    throw new Error("Business not found.");
  }

  const baseWhere: Prisma.TransactionWhereInput = {
    businessId,
    environment: options.environment,
  };

  const [totalAllTime, inPeriod, last24hCount, last7dCount] = await Promise.all([
    prisma.transaction.count({ where: baseWhere }),
    prisma.transaction.count({ where: { ...baseWhere, createdAt: { gte: periodFrom } } }),
    prisma.transaction.count({ where: { ...baseWhere, createdAt: { gte: since24h } } }),
    prisma.transaction.count({ where: { ...baseWhere, createdAt: { gte: since7d } } }),
  ]);

  const [statusAllTime, statusInPeriod] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["status"],
      where: { ...baseWhere, createdAt: { gte: periodFrom } },
      _count: { _all: true },
    }),
  ]);

  const byStatusAllTime: Record<string, number> = {};
  for (const row of statusAllTime) {
    byStatusAllTime[row.status] = row._count._all;
  }
  const byStatusInPeriod: Record<string, number> = {};
  for (const row of statusInPeriod) {
    byStatusInPeriod[row.status] = row._count._all;
  }

  const periodTxs = await prisma.transaction.findMany({
    where: {
      businessId,
      environment: options.environment,
      status: COMPLETED,
      createdAt: { gte: periodFrom },
    },
    select: {
      f_amount: true,
      t_amount: true,
      f_tokenPriceUsd: true,
      t_tokenPriceUsd: true,
      platformFee: true,
      merchantFee: true,
    },
  });

  let volumeUsdInPeriod = 0;
  let platformFeesUsdInPeriod = 0;
  let merchantFeesUsdInPeriod = 0;
  for (const t of periodTxs) {
    volumeUsdInPeriod += transactionVolumeUsdApprox(t);
    platformFeesUsdInPeriod += Number((t.platformFee ?? 0).toString() || 0);
    merchantFeesUsdInPeriod += Number((t.merchantFee ?? 0).toString() || 0);
  }

  const fees = await getAccumulatedFees({
    since: periodFrom,
    businessId,
    environment: options.environment,
  });

  const payoutGroups = await prisma.payout.groupBy({
    by: ["status"],
    where: { businessId, environment: options.environment },
    _count: { _all: true },
  });
  const countByStatus: Record<string, number> = {};
  for (const row of payoutGroups) {
    countByStatus[row.status] = row._count._all;
  }

  const payoutAmounts = await prisma.payout.groupBy({
    by: ["currency", "status"],
    where: { businessId, environment: options.environment },
    _sum: { amount: true },
  });
  const amountSumByCurrencyAndStatus = payoutAmounts.map((row) => ({
    currency: row.currency,
    status: row.status,
    sum: row._sum.amount != null ? String(row._sum.amount) : "0",
  }));

  const seriesStart = startOfUtcDay(new Date(now.getTime() - (seriesDays - 1) * 24 * 60 * 60 * 1000));
  const seriesRows = await prisma.transaction.findMany({
    where: { businessId, environment: options.environment, createdAt: { gte: seriesStart } },
    select: {
      createdAt: true,
      status: true,
      f_amount: true,
      t_amount: true,
      f_tokenPriceUsd: true,
      t_tokenPriceUsd: true,
    },
  });

  const bucketMap = new Map<string, { transactionCount: number; completedVolumeUsd: number }>();
  for (const row of seriesRows) {
    const key = row.createdAt.toISOString().slice(0, 10);
    const cur = bucketMap.get(key) ?? { transactionCount: 0, completedVolumeUsd: 0 };
    cur.transactionCount += 1;
    if (row.status === COMPLETED) {
      cur.completedVolumeUsd += transactionVolumeUsdApprox(row);
    }
    bucketMap.set(key, cur);
  }

  const [totalPaymentLinks, linkCompletedInPeriod] = await Promise.all([
    prisma.paymentLink.count({ where: { businessId, environment: options.environment } }),
    prisma.transaction.findMany({
      where: {
        businessId,
        environment: options.environment,
        status: COMPLETED,
        createdAt: { gte: periodFrom },
        paymentLinkId: { not: null },
      },
      select: {
        paymentLinkId: true,
        f_amount: true,
        t_amount: true,
        f_tokenPriceUsd: true,
        t_tokenPriceUsd: true,
      },
    }),
  ]);

  let paymentLinkVolumeUsd = 0;
  const distinctLinksUsed = new Set<string>();
  for (const t of linkCompletedInPeriod) {
    if (t.paymentLinkId) distinctLinksUsed.add(t.paymentLinkId);
    paymentLinkVolumeUsd += transactionVolumeUsdApprox(t);
  }

  const series: MerchantSummaryResult["series"] = [];
  for (let i = 0; i < seriesDays; i += 1) {
    const d = new Date(seriesStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const b = bucketMap.get(key) ?? { transactionCount: 0, completedVolumeUsd: 0 };
    series.push({
      date: key,
      transactionCount: b.transactionCount,
      completedVolumeUsd: Math.round(b.completedVolumeUsd * 100) / 100,
    });
  }

  return {
    periodDays,
    seriesDays,
    periodFrom: periodFrom.toISOString(),
    periodTo: now.toISOString(),
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      kybStatus: business.kybStatus,
    },
    transactions: {
      totalAllTime,
      inPeriod,
      byStatusAllTime,
      byStatusInPeriod,
      last24hCount,
      last7dCount,
      volumeUsdInPeriod: Math.round(volumeUsdInPeriod * 100) / 100,
      completedCountInPeriod: periodTxs.length,
      platformFeesUsdInPeriod: Math.round(platformFeesUsdInPeriod * 100) / 100,
      merchantFeesUsdInPeriod: Math.round(merchantFeesUsdInPeriod * 100) / 100,
    },
    fees: {
      byCurrency: fees.byCurrency,
      totalConvertedUsd: Math.round(fees.totalConverted * 100) / 100,
    },
    settlements: {
      countByStatus,
      amountSumByCurrencyAndStatus,
    },
    paymentLinks: {
      volumeUsdInPeriod: Math.round(paymentLinkVolumeUsd * 100) / 100,
      completedTxWithLinkCount: linkCompletedInPeriod.length,
      distinctLinksUsedInPeriod: distinctLinksUsed.size,
      totalPaymentLinks,
    },
    series,
  };
}
