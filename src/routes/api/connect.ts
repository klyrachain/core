/**
 * Connect (B2B) API: overview, merchants, settlements for Platform/B2B operations.
 * Platform keys / session see all data; merchant keys see only their own business/settlements.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import {
  PERMISSION_CONNECT_OVERVIEW,
  PERMISSION_CONNECT_TRANSACTIONS,
  PERMISSION_CONNECT_BUSINESSES,
  PERMISSION_CONNECT_PAYOUTS,
  PERMISSION_BUSINESS_READ,
} from "../../lib/permissions.js";
import type { MerchantEnvironment, Prisma } from "../../../prisma/generated/prisma/client.js";
import { KybStatus, PayoutStatus } from "../../../prisma/generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import {
  parsePagination,
  successEnvelope,
  successEnvelopeWithMeta,
  errorEnvelope,
} from "../../lib/api-helpers.js";

const COMPLETED_STATUS = "COMPLETED";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** Connect aggregate routes are platform-only (defense in depth). */
function rejectTenantConnectAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.apiKey?.businessId) {
    reply.status(403).send({
      success: false,
      error: "This Connect endpoint is for platform use only. Use /api/v1/merchant/* for tenant data.",
      code: "TENANT_FORBIDDEN",
    });
    return true;
  }
  return false;
}

function toNum(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return parseFloat(String(v)) || 0;
}

/** Accumulated fees by currency. Fee is attributed by trading pair: the "to" (quote) token. */
export type FeesByCurrency = Record<string, string>;

type FeeRow = {
  fee: { toString(): string } | null;
  f_token: string;
  t_token: string;
  feeInUsd: { toString(): string } | null;
  t_tokenPriceUsd: { toString(): string } | null;
};

/**
 * Aggregate completed transactions: sum fee by t_token (fee is denominated in the "to" / quote
 * currency of the pair). totalConverted = sum of feeInUsd (stored at completion); when feeInUsd
 * is null (legacy rows), fee is excluded from totalConverted.
 */
export async function getAccumulatedFees(options: {
  since?: Date;
  businessId?: string | null;
  /** When true, only transactions with a business (partner) are included. */
  partnerOnly?: boolean;
  /** Tenant isolation for merchant dashboards (TEST vs LIVE). */
  environment?: MerchantEnvironment;
}): Promise<{ byCurrency: FeesByCurrency; totalConverted: number }> {
  const where: Prisma.TransactionWhereInput = {
    status: COMPLETED_STATUS,
    fee: { not: null },
  };
  if (options.since) where.createdAt = { gte: options.since };
  if (options.businessId != null && options.businessId !== "") where.businessId = options.businessId;
  if (options.partnerOnly) where.businessId = { not: null };
  if (options.environment != null) where.environment = options.environment;

  const rows = await prisma.transaction.findMany({
    where,
    select: { fee: true, f_token: true, t_token: true, feeInUsd: true, t_tokenPriceUsd: true },
  });

  const byCurrency: Record<string, number> = {};
  let totalConverted = 0;
  for (const r of rows as FeeRow[]) {
    const fee = toNum(r.fee);
    if (fee <= 0) continue;
    const token = r.t_token || "UNKNOWN";
    byCurrency[token] = (byCurrency[token] ?? 0) + fee;
    const feeUsd = toNum(r.feeInUsd);
    if (Number.isFinite(feeUsd) && feeUsd > 0) {
      totalConverted += feeUsd;
    } else {
      const rate = toNum(r.t_tokenPriceUsd);
      if (Number.isFinite(rate) && rate > 0) totalConverted += fee * rate;
    }
  }
  const byCurrencyStr: FeesByCurrency = {};
  for (const [k, v] of Object.entries(byCurrency)) {
    byCurrencyStr[k] = String(Math.round(v * 1e8) / 1e8);
  }
  return { byCurrency: byCurrencyStr, totalConverted };
}

export async function connectApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/connect/overview ---
  app.get("/api/connect/overview", async (req: FastifyRequest, reply) => {
    try {
      if (rejectTenantConnectAccess(req, reply)) return;
      if (!requirePermission(req, reply, PERMISSION_CONNECT_OVERVIEW)) return;

      const now = new Date();
      const since24h = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);

      // Partner transactions only (businessId not null), completed
      const partnerTxns = await prisma.transaction.findMany({
        where: {
          businessId: { not: null },
          status: COMPLETED_STATUS,
        },
        select: {
          id: true,
          businessId: true,
          createdAt: true,
          f_amount: true,
          t_amount: true,
          f_tokenPriceUsd: true,
          t_tokenPriceUsd: true,
          platformFee: true,
        },
      });

      const totalPlatformVolume = partnerTxns.reduce((sum, partnerTxn) => {
        const sideF = toNum(partnerTxn.f_amount) * toNum(partnerTxn.f_tokenPriceUsd);
        const sideT = toNum(partnerTxn.t_amount) * toNum(partnerTxn.t_tokenPriceUsd);
        if (sideF > 0 && sideT > 0) return sum + (sideF + sideT) / 2;
        return sum + sideF + sideT;
      }, 0);

      const netRevenueFees = partnerTxns.reduce(
        (sum, partnerTxn) => sum + toNum(partnerTxn.platformFee),
        0
      );

      const activeMerchants = new Set(
        partnerTxns
          .filter(
            (partnerTxn) =>
              partnerTxn.createdAt && new Date(partnerTxn.createdAt) >= since24h
          )
          .map((partnerTxn) => partnerTxn.businessId)
          .filter(Boolean)
      ).size;

      // Volume by partner (top 5 + others)
      const volumeByBusinessId = new Map<string, number>();
      for (const partnerTxn of partnerTxns) {
        const bid = partnerTxn.businessId ?? "_unknown";
        const sideF = toNum(partnerTxn.f_amount) * toNum(partnerTxn.f_tokenPriceUsd);
        const sideT = toNum(partnerTxn.t_amount) * toNum(partnerTxn.t_tokenPriceUsd);
        const gross = sideF > 0 && sideT > 0 ? (sideF + sideT) / 2 : sideF + sideT;
        volumeByBusinessId.set(bid, (volumeByBusinessId.get(bid) ?? 0) + gross);
      }
      const sorted = [...volumeByBusinessId.entries()].sort(
        (entryA, entryB) => entryB[1] - entryA[1]
      );
      const top5 = sorted.slice(0, 5);
      const othersVolume = sorted.slice(5).reduce((total, [, volume]) => total + volume, 0);

      const businessIds = top5.map(([id]) => id).filter((id) => id !== "_unknown");
      const businesses =
        businessIds.length > 0
          ? await prisma.business.findMany({
            where: { id: { in: businessIds } },
            select: { id: true, name: true },
          })
          : [];
      const nameById = Object.fromEntries(
        businesses.map((business) => [business.id, business.name])
      );

      const volumeByPartner = top5.map(([businessId, volume]) => ({
        businessId,
        businessName: nameById[businessId] ?? "Unknown",
        volume,
      }));
      if (othersVolume > 0) {
        volumeByPartner.push({ businessId: "_others", businessName: "Others", volume: othersVolume });
      }

      const takeRate = totalPlatformVolume > 0 ? netRevenueFees / totalPlatformVolume : 0;

      // Recent onboarding: businesses that have at least one API key, ordered by first key createdAt
      const recentKeys = await prisma.apiKey.findMany({
        where: { businessId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { businessId: true, createdAt: true },
        distinct: ["businessId"],
      });
      const recentBusinessIds = recentKeys
        .map((apiKeyRow) => apiKeyRow.businessId)
        .filter(Boolean) as string[];
      const recentBusinesses =
        recentBusinessIds.length > 0
          ? await prisma.business.findMany({
            where: { id: { in: recentBusinessIds } },
            select: { id: true, name: true, slug: true, createdAt: true },
          })
          : [];
      const recentOnboarding = recentBusinessIds
        .map((businessId) =>
          recentBusinesses.find((business) => business.id === businessId)
        )
        .filter(Boolean)
        .map((business) => ({
          id: business!.id,
          name: business!.name,
          slug: business!.slug,
          createdAt: business!.createdAt.toISOString(),
        }));

      const { byCurrency: feesByCurrency } = await getAccumulatedFees({ partnerOnly: true });

      return successEnvelope(reply, {
        totalPlatformVolume,
        netRevenueFees,
        activeMerchants,
        volumeByPartner,
        takeRate,
        recentOnboarding,
        feesByCurrency,
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/connect/overview");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/connect/fees/report ---
  app.get(
    "/api/connect/fees/report",
    async (
      req: FastifyRequest<{ Querystring: { days?: string; businessId?: string } }>,
      reply
    ) => {
      try {
        if (rejectTenantConnectAccess(req, reply)) return;
        if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;

        const days = Math.min(Math.max(parseInt(req.query.days ?? "0", 10) || 0, 0), 365);
        const since = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
        const businessId = req.query.businessId ?? undefined;

        const { byCurrency, totalConverted } = await getAccumulatedFees({
          since,
          businessId: businessId ? businessId : undefined,
        });

        return successEnvelope(reply, {
          byCurrency,
          totalConverted: Math.round(totalConverted * 1e8) / 1e8,
          days: days || null,
          businessId: businessId || null,
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/connect/fees/report");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/connect/merchants ---
  app.get(
    "/api/connect/merchants",
    async (
      req: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          status?: string; // KybStatus or "all"
          riskLevel?: string; // "high" | "low" | "all"
        };
      }>,
      reply
    ) => {
      try {
        if (rejectTenantConnectAccess(req, reply)) return;
        if (!requirePermission(req, reply, PERMISSION_CONNECT_BUSINESSES)) return;

        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const riskLevel = req.query.riskLevel?.trim();

        const where: Prisma.BusinessWhereInput = {};
        if (status && status !== "all") {
          const valid: KybStatus[] = ["NOT_STARTED", "PENDING", "APPROVED", "REJECTED", "RESTRICTED"];
          if (valid.includes(status as KybStatus)) where.kybStatus = status as KybStatus;
        }
        if (riskLevel === "high") where.riskScore = { gte: 50 };
        if (riskLevel === "low") where.riskScore = { lte: 49 };

        const [businesses, total] = await Promise.all([
          prisma.business.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              feeSchedule: { select: { percentageFee: true, flatFee: true, maxFee: true } },
            },
          }),
          prisma.business.count({ where }),
        ]);

        type BusinessWithFee = (typeof businesses)[number];
        const data = businesses.map((b: BusinessWithFee) => ({
          id: b.id,
          accountId: `acct_${b.slug}`,
          name: b.name,
          slug: b.slug,
          logoUrl: b.logoUrl ?? undefined,
          kybStatus: b.kybStatus,
          riskScore: b.riskScore,
          balance: 0, // TODO: compute from txns - payouts when currency strategy is fixed
          feeTier: b.feeSchedule
            ? {
              percentage: toNum(b.feeSchedule.percentageFee),
              flat: toNum(b.feeSchedule.flatFee),
              max: b.feeSchedule.maxFee != null ? toNum(b.feeSchedule.maxFee) : undefined,
            }
            : { percentage: 1, flat: 0, max: undefined },
          createdAt: b.createdAt.toISOString(),
        }));

        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/connect/merchants");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/connect/merchants/:id ---
  app.get(
    "/api/connect/merchants/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const { id } = req.params;
        const isMerchant = !!(req as FastifyRequest & { apiKey?: { businessId?: string } }).apiKey?.businessId;
        if (isMerchant && req.apiKey && req.apiKey.businessId !== id) {
          return errorEnvelope(reply, "You can only view your own business.", 403);
        }

        const business = await prisma.business.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            website: true,
            supportEmail: true,
            kybStatus: true,
            riskScore: true,
            webhookUrl: true,
            createdAt: true,
            apiKeys: {
              select: { id: true, keyPrefix: true, name: true, lastUsedAt: true, isActive: true },
            },
            _count: { select: { transactions: true } },
          },
        });

        if (!business) return errorEnvelope(reply, "Merchant not found.", 404);

        // Volume last 30 days (gross from completed txns)
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const txns = await prisma.transaction.findMany({
          where: { businessId: id, status: COMPLETED_STATUS, createdAt: { gte: since30d } },
          select: { f_amount: true, t_amount: true, f_tokenPriceUsd: true, t_tokenPriceUsd: true },
        });
        const volume30d = txns.reduce((sum, txn) => {
          const sideF = toNum(txn.f_amount) * toNum(txn.f_tokenPriceUsd);
          const sideT = toNum(txn.t_amount) * toNum(txn.t_tokenPriceUsd);
          return sum + (sideF > 0 && sideT > 0 ? (sideF + sideT) / 2 : sideF + sideT);
        }, 0);

        return successEnvelope(reply, {
          id: business.id,
          accountId: `acct_${business.slug}`,
          name: business.name,
          slug: business.slug,
          logoUrl: business.logoUrl ?? undefined,
          website: business.website ?? undefined,
          supportEmail: business.supportEmail ?? undefined,
          kybStatus: business.kybStatus,
          riskScore: business.riskScore,
          webhookUrl: business.webhookUrl ?? undefined,
          createdAt: business.createdAt.toISOString(),
          apiKeys: business.apiKeys.map((apiKey) => ({
            id: apiKey.id,
            keyPrefix: apiKey.keyPrefix,
            name: apiKey.name,
            lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
            isActive: apiKey.isActive,
          })),
          transactionCount: business._count.transactions,
          volume30d,
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/connect/merchants/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/connect/settlements ---
  app.get(
    "/api/connect/settlements",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; status?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_CONNECT_PAYOUTS, { allowMerchant: true })) return;

        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const businessId = req.apiKey?.businessId ?? undefined; // platform (session or key) sees all; merchant sees only their payouts

        const where: Prisma.PayoutWhereInput = {};
        if (businessId) where.businessId = businessId;
        if (status && status !== "all") {
          const valid: PayoutStatus[] = ["SCHEDULED", "PROCESSING", "PAID", "FAILED", "REVERSED"];
          if (valid.includes(status as PayoutStatus)) where.status = status as PayoutStatus;
        }

        const [payouts, total] = await Promise.all([
          prisma.payout.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              business: { select: { id: true, name: true, slug: true } },
            },
          }),
          prisma.payout.count({ where }),
        ]);

        const data = payouts.map((payout) => ({
          id: payout.id,
          batchId: payout.batchId ?? payout.id,
          businessId: payout.businessId,
          businessName: (payout as { business: { name: string; slug: string } }).business.name,
          businessSlug: (payout as { business: { name: string; slug: string } }).business.slug,
          amount: toNum(payout.amount),
          fee: toNum(payout.fee),
          currency: payout.currency,
          status: payout.status,
          reference: payout.reference ?? undefined,
          createdAt: payout.createdAt.toISOString(),
          updatedAt: payout.updatedAt.toISOString(),
        }));

        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/connect/settlements");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/connect/settlements/:id ---
  app.get(
    "/api/connect/settlements/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_CONNECT_PAYOUTS, { allowMerchant: true })) return;
        const { id } = req.params;
        const businessId = req.apiKey?.businessId ?? undefined;

        const payout = await prisma.payout.findUnique({
          where: { id },
          include: {
            business: { select: { id: true, name: true, slug: true } },
            method: { select: { id: true, type: true, currency: true } },
          },
        });

        if (!payout) return errorEnvelope(reply, "Settlement not found.", 404);
        if (businessId && payout.businessId !== businessId) {
          return errorEnvelope(reply, "You can only view your own settlements.", 403);
        }

        const gross = toNum(payout.amount) + toNum(payout.fee);
        return successEnvelope(reply, {
          id: payout.id,
          batchId: payout.batchId ?? undefined,
          business: payout.business,
          method: payout.method,
          amount: toNum(payout.amount),
          fee: toNum(payout.fee),
          gross,
          currency: payout.currency,
          status: payout.status,
          reference: payout.reference ?? undefined,
          createdAt: payout.createdAt.toISOString(),
          updatedAt: payout.updatedAt.toISOString(),
          timeline: [
            { step: "Created", at: payout.createdAt.toISOString(), done: true },
            {
              step: payout.status === "PAID" || payout.status === "FAILED" ? "Processed" : "Processing",
              at: payout.updatedAt.toISOString(),
              done: ["PAID", "FAILED", "REVERSED"].includes(payout.status),
            },
          ],
          sourceTransactions: [], // TODO: when Payout–Transaction link exists
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/connect/settlements/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
