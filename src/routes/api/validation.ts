/**
 * Validation API: cache refresh, failed validations list (management).
 * All endpoints require platform admin key.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope, parsePagination, successEnvelopeWithMeta } from "../../lib/api-helpers.js";
import {
  loadValidationCache,
  ensureValidationCache,
  getCachedPricingQuote,
  getCachedPlatformFee,
  getCachedChains,
} from "../../services/validation-cache.service.js";
import { getOnrampQuote } from "../../services/onramp-quote.service.js";
import { getRedis } from "../../lib/redis.js";
import {
  VALIDATION_FAILED_LIST_KEY,
  VALIDATION_KEY_PRICING_QUOTE,
  VALIDATION_CACHE_TTL_SECONDS,
} from "../../lib/redis.js";

function requirePlatformKey(req: FastifyRequest, reply: import("fastify").FastifyReply): boolean {
  if (!req.apiKey) {
    errorEnvelope(reply, "Not authenticated.", 401);
    return false;
  }
  if (req.apiKey.businessId) {
    errorEnvelope(reply, "This endpoint is for platform use only.", 403);
    return false;
  }
  return true;
}

export async function validationApiRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/validation/cache/refresh — reload providers, chains, tokens, platform fee from DB into Redis (24h cache). */
  app.post("/api/validation/cache/refresh", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePlatformKey(req, reply)) return;
      await loadValidationCache();
      return successEnvelope(reply, { refreshed: true });
    } catch (err) {
      req.log.error({ err }, "POST /api/validation/cache/refresh");
      return errorEnvelope(reply, "Failed to refresh validation cache.", 500);
    }
  });

  /** GET /api/validation/pricing-quote — pricing quote for validation. Optional ?chain=&token= returns per-token quote. costPrice = volume-weighted inventory cost basis. When ?country= is also provided, providerBuyPrice = onramp provider rate (e.g. GHS per USDC from Fonbnk); otherwise providerBuyPrice = cost basis. costBasisSource indicates 'inventory' or 'default'. */
  app.get(
    "/api/validation/pricing-quote",
    async (
      req: FastifyRequest<{ Querystring: { chain?: string; token?: string; country?: string } }>,
      reply
    ) => {
      try {
        if (!requirePlatformKey(req, reply)) return;
        await ensureValidationCache();
        const chain = (req.query.chain as string)?.trim();
        const token = (req.query.token as string)?.trim();
        const country = (req.query.country as string)?.trim();
        const quote = await getCachedPricingQuote(chain || undefined, token || undefined);
        let pricingQuote = quote ?? null;
        if (pricingQuote && chain && token && country) {
          const chains = await getCachedChains();
          const chainRecord = chains?.find((c) => c.code === chain.toUpperCase());
          if (chainRecord) {
            const onrampResult = await getOnrampQuote({
              country: country.toUpperCase().slice(0, 2),
              chain_id: chainRecord.chainId,
              token,
              amount: 1,
              amount_in: "crypto",
              purchase_method: "buy",
            });
            if (onrampResult.ok) {
              const rateFiatPerCrypto = onrampResult.data.total_fiat;
              if (Number.isFinite(rateFiatPerCrypto) && rateFiatPerCrypto > 0) {
                pricingQuote = {
                  ...pricingQuote,
                  providerBuyPrice: rateFiatPerCrypto,
                };
              }
            }
          }
        }
        const platformFee = await getCachedPlatformFee();
        return successEnvelope(reply, {
          pricingQuote,
          platformFee: platformFee ?? null,
          chain: chain || null,
          token: token || null,
          country: country || null,
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/validation/pricing-quote");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** POST /api/validation/pricing-quote — set pricing quote (required for onramp/offramp validation). */
  app.post(
    "/api/validation/pricing-quote",
    async (
      req: FastifyRequest<{
        Body: { providerBuyPrice?: number; providerSellPrice?: number; volatility?: number };
      }>,
      reply
    ) => {
      try {
        if (!requirePlatformKey(req, reply)) return;
        const body = req.body ?? {};
        const r = getRedis();
        const existing = await r.get(VALIDATION_KEY_PRICING_QUOTE);
        const current = existing ? (JSON.parse(existing) as { providerBuyPrice: number; providerSellPrice: number; volatility: number }) : { providerBuyPrice: 1, providerSellPrice: 0.99, volatility: 0.01 };
        const next = {
          providerBuyPrice: typeof body.providerBuyPrice === "number" ? body.providerBuyPrice : current.providerBuyPrice,
          providerSellPrice: typeof body.providerSellPrice === "number" ? body.providerSellPrice : current.providerSellPrice,
          volatility: typeof body.volatility === "number" ? body.volatility : current.volatility,
        };
        if (next.providerBuyPrice <= 0 || next.providerSellPrice <= 0 || next.volatility < 0) {
          return errorEnvelope(reply, "providerBuyPrice and providerSellPrice must be positive; volatility must be non-negative.", 400);
        }
        await r.set(VALIDATION_KEY_PRICING_QUOTE, JSON.stringify(next), "EX", VALIDATION_CACHE_TTL_SECONDS);
        return successEnvelope(reply, next);
      } catch (err) {
        req.log.error({ err }, "POST /api/validation/pricing-quote");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** GET /api/validation/failed — list failed order validations (DB, paginated) for management. */
  app.get(
    "/api/validation/failed",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; code?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePlatformKey(req, reply)) return;
        const { page, limit, skip } = parsePagination(req.query);
        const codeFilter = (req.query.code as string)?.trim();
        const where = codeFilter ? { code: codeFilter } : {};
        const [items, total] = await Promise.all([
          prisma.failedOrderValidation.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
          }),
          prisma.failedOrderValidation.count({ where }),
        ]);
        const data = items.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          reason: r.reason,
          code: r.code,
          payload: r.payload,
          requestId: r.requestId,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/validation/failed");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** GET /api/validation/failed/recent — last N from Redis list (fast, no DB). */
  app.get(
    "/api/validation/failed/recent",
    async (
      req: FastifyRequest<{ Querystring: { limit?: string } }>,
      reply
    ) => {
      try {
        if (!requirePlatformKey(req, reply)) return;
        const limit = Math.min(parseInt(req.query.limit ?? "50", 10) || 50, 200);
        const r = getRedis();
        const raw = await r.lrange(VALIDATION_FAILED_LIST_KEY, 0, limit - 1);
        const data = raw.map((s) => {
          try {
            return JSON.parse(s) as { at: string; code: string; error: string; payload: Record<string, unknown> };
          } catch {
            return { raw: s };
          }
        });
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "GET /api/validation/failed/recent");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** GET /api/validation/failed/report — aggregated report for frontend dashboard (counts by code, last 24h/7d, daily buckets). */
  app.get(
    "/api/validation/failed/report",
    async (
      req: FastifyRequest<{ Querystring: { days?: string } }>,
      reply
    ) => {
      try {
        if (!requirePlatformKey(req, reply)) return;
        const days = Math.min(Math.max(parseInt(req.query.days ?? "7", 10) || 7, 1), 90);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const now = new Date();

        const [total, byCodeRows, last24h, last7d, dailyBuckets] = await Promise.all([
          prisma.failedOrderValidation.count(),
          prisma.failedOrderValidation.groupBy({
            by: ["code"],
            where: { createdAt: { gte: since } },
            _count: { code: true },
          }),
          prisma.failedOrderValidation.count({
            where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
          }),
          prisma.failedOrderValidation.count({
            where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
          }),
          prisma.$queryRaw<
            Array<{ date: string; count: bigint }>
          >`
            SELECT date_trunc('day', "createdAt")::date::text AS date, count(*)::bigint AS count
            FROM "FailedOrderValidation"
            WHERE "createdAt" >= ${since}
            GROUP BY date_trunc('day', "createdAt")::date
            ORDER BY date ASC
          `.catch(() => []),
        ]);

        const byCode: Record<string, number> = {};
        for (const row of byCodeRows) {
          byCode[row.code ?? "UNKNOWN"] = row._count.code;
        }

        const report = {
          total,
          last24h,
          last7d,
          byCode,
          daily: (dailyBuckets ?? []).map((r) => ({
            date: r.date,
            count: Number(r.count),
          })),
          since: since.toISOString(),
          generatedAt: now.toISOString(),
        };

        return successEnvelope(reply, report);
      } catch (err) {
        req.log.error({ err }, "GET /api/validation/failed/report");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
