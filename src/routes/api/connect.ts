/**
 * Connect (B2B) API: overview, merchants, settlements for Platform/B2B operations.
 * Platform keys see all data; merchant keys see only their own business/settlements.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
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

function toNum(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return parseFloat(String(v)) || 0;
}

/** Accumulated fees by currency (fee is stored in f_token per transaction). */
export type FeesByCurrency = Record<string, string>;

type FeeRow = { fee: { toString(): string } | null; f_token: string; type: string; f_price: { toString(): string }; t_price: { toString(): string } };

/** Aggregate completed transactions: sum fee by f_token; optional total converted using f_price (sell) / t_price (buy). */
export async function getAccumulatedFees(options: {
  since?: Date;
  businessId?: string | null;
  /** When true, only transactions with a business (partner) are included. */
  partnerOnly?: boolean;
}): Promise<{ byCurrency: FeesByCurrency; totalConverted: number }> {
  const where: Prisma.TransactionWhereInput = {
    status: COMPLETED_STATUS,
    fee: { not: null },
  };
  if (options.since) where.createdAt = { gte: options.since };
  if (options.businessId != null && options.businessId !== "") where.businessId = options.businessId;
  if (options.partnerOnly) where.businessId = { not: null };

  const rows = await prisma.transaction.findMany({
    where,
    select: { fee: true, f_token: true, type: true, f_price: true, t_price: true },
  });

  const byCurrency: Record<string, number> = {};
  let totalConverted = 0;
  for (const r of rows as FeeRow[]) {
    const fee = toNum(r.fee);
    if (fee <= 0) continue;
    const token = r.f_token || "UNKNOWN";
    byCurrency[token] = (byCurrency[token] ?? 0) + fee;
    const rate =
      r.type === "SELL" || r.type === "REQUEST" || r.type === "CLAIM"
        ? toNum(r.f_price)
        : toNum(r.t_price);
    if (Number.isFinite(rate) && rate > 0) totalConverted += fee * rate;
  }
  const byCurrencyStr: FeesByCurrency = {};
  for (const [k, v] of Object.entries(byCurrency)) {
    byCurrencyStr[k] = String(Math.round(v * 1e8) / 1e8);
  }
  return { byCurrency: byCurrencyStr, totalConverted };
}

/** Require platform key (no businessId). Returns 403 if merchant key. */
function requirePlatformKey(req: FastifyRequest, reply: import("fastify").FastifyReply): boolean {
  if (req.apiKey?.businessId) {
    errorEnvelope(reply, "This endpoint is for platform use only.", 403);
    return false;
  }
  return true;
}

export async function connectApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/connect/overview ---
  app.get("/api/connect/overview", async (req: FastifyRequest, reply) => {
    try {
      if (!req.apiKey) return errorEnvelope(reply, "Not authenticated.", 401);
      if (!requirePlatformKey(req, reply)) return;

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
          f_price: true,
          t_price: true,
          platformFee: true,
        },
      });

      const totalPlatformVolume = partnerTxns.reduce((sum, t) => {
        const gross = toNum(t.f_amount) * toNum(t.f_price) + toNum(t.t_amount) * toNum(t.t_price);
        return sum + gross / 2; // approximate single-side value
      }, 0);

      const netRevenueFees = partnerTxns.reduce((sum, t) => sum + toNum(t.platformFee), 0);

      const activeMerchants = new Set(
        partnerTxns
          .filter((t) => t.createdAt && new Date(t.createdAt) >= since24h)
          .map((t) => t.businessId)
          .filter(Boolean)
      ).size;

      // Volume by partner (top 5 + others)
      const volumeByBusinessId = new Map<string, number>();
      for (const t of partnerTxns) {
        const bid = t.businessId ?? "_unknown";
        const gross = (toNum(t.f_amount) * toNum(t.f_price) + toNum(t.t_amount) * toNum(t.t_price)) / 2;
        volumeByBusinessId.set(bid, (volumeByBusinessId.get(bid) ?? 0) + gross);
      }
      const sorted = [...volumeByBusinessId.entries()].sort((a, b) => b[1] - a[1]);
      const top5 = sorted.slice(0, 5);
      const othersVolume = sorted.slice(5).reduce((s, [, v]) => s + v, 0);

      const businessIds = top5.map(([id]) => id).filter((id) => id !== "_unknown");
      const businesses =
        businessIds.length > 0
          ? await prisma.business.findMany({
              where: { id: { in: businessIds } },
              select: { id: true, name: true },
            })
          : [];
      const nameById = Object.fromEntries(businesses.map((b) => [b.id, b.name]));

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
      const recentBusinessIds = recentKeys.map((k) => k.businessId).filter(Boolean) as string[];
      const recentBusinesses =
        recentBusinessIds.length > 0
          ? await prisma.business.findMany({
              where: { id: { in: recentBusinessIds } },
              select: { id: true, name: true, slug: true, createdAt: true },
            })
          : [];
      const recentOnboarding = recentBusinessIds
        .map((id) => recentBusinesses.find((b) => b.id === id))
        .filter(Boolean)
        .map((b) => ({
          id: b!.id,
          name: b!.name,
          slug: b!.slug,
          createdAt: b!.createdAt.toISOString(),
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
        if (!req.apiKey) return errorEnvelope(reply, "Not authenticated.", 401);
        if (!requirePlatformKey(req, reply)) return;

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
        if (!req.apiKey) return errorEnvelope(reply, "Not authenticated.", 401);
        if (!requirePlatformKey(req, reply)) return;

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
        if (!req.apiKey) return errorEnvelope(reply, "Not authenticated.", 401);
        const { id } = req.params;
        const isMerchant = !!req.apiKey.businessId;
        if (isMerchant && req.apiKey.businessId !== id) {
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
          select: { f_amount: true, f_price: true, t_amount: true, t_price: true },
        });
        const volume30d = txns.reduce((s, t) => s + (toNum(t.f_amount) * toNum(t.f_price) + toNum(t.t_amount) * toNum(t.t_price)) / 2, 0);

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
          apiKeys: business.apiKeys.map((k) => ({
            id: k.id,
            keyPrefix: k.keyPrefix,
            name: k.name,
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
            isActive: k.isActive,
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
        if (!req.apiKey) return errorEnvelope(reply, "Not authenticated.", 401);

        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const businessId = req.apiKey.businessId; // merchant sees only their payouts

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

        const data = payouts.map((p) => ({
          id: p.id,
          batchId: p.batchId ?? p.id,
          businessId: p.businessId,
          businessName: (p as { business: { name: string; slug: string } }).business.name,
          businessSlug: (p as { business: { name: string; slug: string } }).business.slug,
          amount: toNum(p.amount),
          fee: toNum(p.fee),
          currency: p.currency,
          status: p.status,
          reference: p.reference ?? undefined,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
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
        if (!req.apiKey) return errorEnvelope(reply, "Not authenticated.", 401);
        const { id } = req.params;
        const businessId = req.apiKey.businessId;

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
