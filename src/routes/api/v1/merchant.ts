import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "../../../../prisma/generated/prisma/client.js";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import {
  parsePagination,
  successEnvelope,
  successEnvelopeWithMeta,
  errorEnvelope,
  serializeTransactionPrices,
} from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import {
  PERMISSION_BUSINESS_READ,
  PERMISSION_BUSINESS_WRITE,
  PERMISSION_PAYOUTS_READ,
  PERMISSION_TRANSACTIONS_READ,
} from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { isFirstActiveMemberOfBusiness } from "../../../lib/business-first-member.js";
import { getMerchantEnvironmentOrThrow } from "../../../lib/merchant-environment.js";
import { requireMerchantRole, OWNER_ADMIN, OWNER_ADMIN_DEV } from "../../../lib/merchant-rbac.js";
import { generateKey, listApiKeysForBusiness } from "../../../services/api-key.service.js";
import { buildMerchantSummary } from "../../../lib/merchant-summary.js";
import { registerMerchantExtendedRoutes } from "./merchant-extended.js";
import { registerMerchantCommerceRoutes } from "./merchant-commerce.js";
import { registerMerchantSaasRoutes } from "./merchant-saas.js";
import { registerMerchantGasRoutes } from "./merchant-gas.js";
import { registerMerchantPortalKycRoutes } from "./merchant-portal-kyc.js";

type PayoutStatus = "SCHEDULED" | "PROCESSING" | "PAID" | "FAILED" | "REVERSED";

function toNum(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

const patchBusinessBody = z.object({
  name: z.string().min(1).max(200).optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  website: z.string().url().max(2048).nullable().optional(),
  supportEmail: z.string().email().max(320).nullable().optional(),
  webhookUrl: z.string().url().max(2048).nullable().optional(),
  brandColor: z.string().min(1).max(32).nullable().optional(),
  buttonColor: z.string().min(1).max(32).nullable().optional(),
  supportUrl: z.string().url().max(2048).nullable().optional(),
  termsOfServiceUrl: z.string().url().max(2048).nullable().optional(),
  returnPolicyUrl: z.string().url().max(2048).nullable().optional(),
});

const createApiKeyBody = z.object({
  name: z.string().min(1).max(120),
  domains: z.array(z.string().min(1).max(500)).min(1).optional(),
  environment: z.enum(["TEST", "LIVE"]).optional(),
});

export async function merchantV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    "/wrapped/summary",
    async (
      req: FastifyRequest<{
        Querystring: { period?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const period = (req.query.period ?? "year").trim().toLowerCase();
        const days =
          period === "month" ? 30 : period === "quarter" ? 90 : 365;
        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const txs = await prisma.transaction.findMany({
          where: {
            businessId,
            environment,
            createdAt: { gte: from },
          },
          select: {
            id: true,
            status: true,
            f_amount: true,
            t_amount: true,
            f_token: true,
            t_token: true,
            f_chain: true,
            t_chain: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        });
        const completed = txs.filter((tx) => tx.status === "COMPLETED");
        const topTokens = new Map<string, number>();
        const topChains = new Map<string, number>();
        for (const tx of completed) {
          topTokens.set(tx.t_token, (topTokens.get(tx.t_token) ?? 0) + Number(tx.t_amount));
          topChains.set(tx.t_chain, (topChains.get(tx.t_chain) ?? 0) + 1);
        }
        return successEnvelope(reply, {
          period,
          totals: {
            transactions: txs.length,
            completed: completed.length,
            successRate: txs.length > 0 ? Number((completed.length / txs.length).toFixed(4)) : 0,
          },
          topTokens: [...topTokens.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([symbol, amount]) => ({ symbol, amount })),
          topChains: [...topChains.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([chain, count]) => ({ chain, count })),
          timeline: txs.map((tx) => ({
            id: tx.id,
            at: tx.createdAt.toISOString(),
            status: tx.status,
            fromAmount: tx.f_amount.toString(),
            toAmount: tx.t_amount.toString(),
            fromToken: tx.f_token,
            toToken: tx.t_token,
            fromChain: tx.f_chain,
            toChain: tx.t_chain,
          })),
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/wrapped/summary");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get(
    "/summary",
    async (
      req: FastifyRequest<{
        Querystring: { days?: string; seriesDays?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const periodDays = Math.min(
          365,
          Math.max(1, parseInt(req.query.days ?? "30", 10) || 30)
        );
        const seriesDays = Math.min(
          90,
          Math.max(1, parseInt(req.query.seriesDays ?? "7", 10) || 7)
        );
        const environment = getMerchantEnvironmentOrThrow(req);
        const data = await buildMerchantSummary(businessId, { periodDays, seriesDays, environment });
        return successEnvelope(reply, data);
      } catch (err) {
        if (err instanceof Error && err.message === "Business not found.") {
          return errorEnvelope(reply, "Business not found.", 404);
        }
        req.log.error({ err }, "GET /api/v1/merchant/summary");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get(
    "/transactions",
    async (
      req: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          status?: string;
          type?: string;
          from?: string;
          to?: string;
          q?: string;
          sort?: string;
        };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const type = req.query.type?.trim();
        const from = req.query.from?.trim();
        const to = req.query.to?.trim();
        const q = req.query.q?.trim();
        const sortDir = req.query.sort === "asc" ? "asc" : "desc";
        const environment = getMerchantEnvironmentOrThrow(req);
        const where: Prisma.TransactionWhereInput = { businessId, environment };
        if (status) {
          where.status = status as "ACTIVE" | "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
        }
        if (type) {
          where.type = type as "BUY" | "SELL" | "TRANSFER" | "REQUEST" | "CLAIM";
        }
        if (from || to) {
          const range: Prisma.DateTimeFilter = {};
          if (from) {
            const d = new Date(from);
            if (!Number.isNaN(d.getTime())) range.gte = d;
          }
          if (to) {
            const d = new Date(to);
            if (!Number.isNaN(d.getTime())) range.lte = d;
          }
          if (Object.keys(range).length > 0) where.createdAt = range;
        }
        if (q) {
          const uuidLike =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q);
          const idOrWallet = [
            { fromIdentifier: { contains: q, mode: "insensitive" } },
            { toIdentifier: { contains: q, mode: "insensitive" } },
          ] as const;
          const linkMatch = {
            paymentLink: { is: { publicCode: { contains: q, mode: "insensitive" as const } } },
          };
          where.OR = uuidLike
            ? [{ id: q }, ...idOrWallet, linkMatch]
            : [...idOrWallet, linkMatch];
        }
        const [items, total] = await Promise.all([
          prisma.transaction.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: sortDir },
            include: {
              fromUser: { select: { id: true, email: true, username: true } },
              toUser: { select: { id: true, email: true, username: true } },
              business: { select: { name: true } },
              paymentLink: { select: { publicCode: true } },
            },
          }),
          prisma.transaction.count({ where }),
        ]);
        const data = items.map((transactionRow) => {
          const { paymentLink, business, ...rest } = transactionRow;
          return {
            ...rest,
            f_amount: transactionRow.f_amount.toString(),
            t_amount: transactionRow.t_amount.toString(),
            ...serializeTransactionPrices(transactionRow),
            fee: transactionRow.fee != null ? transactionRow.fee.toString() : null,
            platformFee:
              transactionRow.platformFee != null ? transactionRow.platformFee.toString() : null,
            merchantFee:
              transactionRow.merchantFee != null ? transactionRow.merchantFee.toString() : null,
            providerPrice:
              transactionRow.providerPrice != null ? transactionRow.providerPrice.toString() : null,
            paymentLinkPublicCode: paymentLink?.publicCode ?? "",
            businessName: business?.name?.trim() ?? "",
          };
        });
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/transactions");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/transactions/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const tx = await prisma.transaction.findFirst({
        where: { id: req.params.id, businessId, environment },
        include: {
          fromUser: { select: { id: true, email: true, address: true, username: true } },
          toUser: { select: { id: true, email: true, address: true, username: true } },
          request: true,
          paymentLink: { select: { publicCode: true } },
        },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found.", 404);
      const { paymentLink, ...txRest } = tx;
      const data = {
        ...txRest,
        f_amount: tx.f_amount.toString(),
        t_amount: tx.t_amount.toString(),
        ...serializeTransactionPrices(tx),
        fee: tx.fee != null ? tx.fee.toString() : null,
        platformFee: tx.platformFee != null ? tx.platformFee.toString() : null,
        merchantFee: tx.merchantFee != null ? tx.merchantFee.toString() : null,
        providerPrice: tx.providerPrice != null ? tx.providerPrice.toString() : null,
        paymentLinkPublicCode: paymentLink?.publicCode ?? "",
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/transactions/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/settlements",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; status?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const environment = getMerchantEnvironmentOrThrow(req);
        const where: Prisma.PayoutWhereInput = { businessId, environment };
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
        const data = payouts.map((payoutRow) => ({
          id: payoutRow.id,
          batchId: payoutRow.batchId ?? payoutRow.id,
          businessId: payoutRow.businessId,
          businessName: payoutRow.business.name,
          businessSlug: payoutRow.business.slug,
          amount: toNum(payoutRow.amount),
          fee: toNum(payoutRow.fee),
          currency: payoutRow.currency,
          status: payoutRow.status,
          reference: payoutRow.reference ?? undefined,
          createdAt: payoutRow.createdAt.toISOString(),
          updatedAt: payoutRow.updatedAt.toISOString(),
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/settlements");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/settlements/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const payout = await prisma.payout.findFirst({
        where: { id: req.params.id, businessId, environment },
        include: {
          business: { select: { id: true, name: true, slug: true } },
          method: { select: { id: true, type: true, currency: true } },
        },
      });
      if (!payout) return errorEnvelope(reply, "Settlement not found.", 404);
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
            step:
              payout.status === "PAID" || payout.status === "FAILED" ? "Processed" : "Processing",
            at: payout.updatedAt.toISOString(),
            done: ["PAID", "FAILED", "REVERSED"].includes(payout.status),
          },
        ],
        sourceTransactions: [],
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/settlements/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/business", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const tenant = req.businessPortalTenant;
      const business = await prisma.business.findUnique({
        where: { id: businessId },
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
          country: true,
          createdAt: true,
          brandColor: true,
          buttonColor: true,
          supportUrl: true,
          termsOfServiceUrl: true,
          returnPolicyUrl: true,
        },
      });
      if (!business) return errorEnvelope(reply, "Business not found.", 404);

      let portalKycStatus: string | null = null;
      let portalKycProvider: string | null = null;
      let portalKycVerifiedAt: string | null = null;
      let isFirstActiveMember = false;

      if (tenant?.userId) {
        const [userRow, firstMember] = await Promise.all([
          prisma.user.findUnique({
            where: { id: tenant.userId },
            select: {
              portalKycStatus: true,
              portalKycProvider: true,
              portalKycVerifiedAt: true,
            },
          }),
          isFirstActiveMemberOfBusiness(tenant.userId, businessId),
        ]);
        portalKycStatus = userRow?.portalKycStatus ?? null;
        portalKycProvider = userRow?.portalKycProvider ?? null;
        portalKycVerifiedAt = userRow?.portalKycVerifiedAt?.toISOString() ?? null;
        isFirstActiveMember = firstMember;
      }

      return successEnvelope(reply, {
        ...business,
        logoUrl: business.logoUrl ?? undefined,
        website: business.website ?? undefined,
        supportEmail: business.supportEmail ?? undefined,
        webhookUrl: business.webhookUrl ?? undefined,
        brandColor: business.brandColor ?? undefined,
        buttonColor: business.buttonColor ?? undefined,
        supportUrl: business.supportUrl ?? undefined,
        termsOfServiceUrl: business.termsOfServiceUrl ?? undefined,
        returnPolicyUrl: business.returnPolicyUrl ?? undefined,
        createdAt: business.createdAt.toISOString(),
        portalKycStatus,
        portalKycProvider,
        portalKycVerifiedAt,
        isFirstActiveMember,
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/business");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/business", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN)) return;
      const parsed = patchBusinessBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid body.",
          details: parsed.error.flatten(),
        });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ success: false, error: "No fields to update." });
      }
      const businessId = getMerchantV1BusinessId(req);
      const business = await prisma.business.update({
        where: { id: businessId },
        data: parsed.data,
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          website: true,
          supportEmail: true,
          webhookUrl: true,
          brandColor: true,
          buttonColor: true,
          supportUrl: true,
          termsOfServiceUrl: true,
          returnPolicyUrl: true,
        },
      });
      return successEnvelope(reply, {
        ...business,
        logoUrl: business.logoUrl ?? undefined,
        website: business.website ?? undefined,
        supportEmail: business.supportEmail ?? undefined,
        webhookUrl: business.webhookUrl ?? undefined,
        brandColor: business.brandColor ?? undefined,
        buttonColor: business.buttonColor ?? undefined,
        supportUrl: business.supportUrl ?? undefined,
        termsOfServiceUrl: business.termsOfServiceUrl ?? undefined,
        returnPolicyUrl: business.returnPolicyUrl ?? undefined,
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/business");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api-keys", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const rows = await listApiKeysForBusiness(businessId);
      const data = rows.map((apiKeyRow) => ({
        id: apiKeyRow.id,
        name: apiKeyRow.name,
        domains: apiKeyRow.domains ?? [],
        keyPrefix: apiKeyRow.keyPrefix,
        isActive: apiKeyRow.isActive,
        lastUsedAt: apiKeyRow.lastUsedAt?.toISOString() ?? null,
        expiresAt: apiKeyRow.expiresAt?.toISOString() ?? null,
        environment: apiKeyRow.environment ?? null,
      }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/api-keys");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/api-keys", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
      const parsed = createApiKeyBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Invalid body.",
          details: parsed.error.flatten(),
        });
      }
      const businessId = getMerchantV1BusinessId(req);
      const domains = parsed.data.domains ?? ["*"];
      const rawKey = await generateKey({
        name: parsed.data.name,
        domains,
        permissions: [],
        businessId,
        environment: parsed.data.environment ?? null,
      });
      return successEnvelope(reply, {
        rawKey,
        message: "Store this key securely; it will not be shown again.",
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/api-keys");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  registerMerchantSaasRoutes(app);
  registerMerchantExtendedRoutes(app);
  registerMerchantCommerceRoutes(app);
  registerMerchantGasRoutes(app);
  registerMerchantPortalKycRoutes(app);
}
