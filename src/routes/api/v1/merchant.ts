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
import { generateKey, listApiKeysForBusiness } from "../../../services/api-key.service.js";

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
});

const createApiKeyBody = z.object({
  name: z.string().min(1).max(120),
  domains: z.array(z.string().min(1).max(500)).min(1).optional(),
});

export async function merchantV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    "/transactions",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; status?: string; type?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const type = req.query.type?.trim();
        const where: Prisma.TransactionWhereInput = { businessId };
        if (status) {
          where.status = status as "ACTIVE" | "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
        }
        if (type) {
          where.type = type as "BUY" | "SELL" | "TRANSFER" | "REQUEST" | "CLAIM";
        }
        const [items, total] = await Promise.all([
          prisma.transaction.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              fromUser: { select: { id: true, email: true, username: true } },
              toUser: { select: { id: true, email: true, username: true } },
            },
          }),
          prisma.transaction.count({ where }),
        ]);
        const data = items.map((t) => ({
          ...t,
          f_amount: t.f_amount.toString(),
          t_amount: t.t_amount.toString(),
          ...serializeTransactionPrices(t),
          fee: t.fee != null ? t.fee.toString() : null,
          platformFee: t.platformFee != null ? t.platformFee.toString() : null,
          merchantFee: t.merchantFee != null ? t.merchantFee.toString() : null,
          providerPrice: t.providerPrice != null ? t.providerPrice.toString() : null,
        }));
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
      const tx = await prisma.transaction.findFirst({
        where: { id: req.params.id, businessId },
        include: {
          fromUser: { select: { id: true, email: true, address: true, username: true } },
          toUser: { select: { id: true, email: true, address: true, username: true } },
          request: true,
        },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found.", 404);
      const data = {
        ...tx,
        f_amount: tx.f_amount.toString(),
        t_amount: tx.t_amount.toString(),
        ...serializeTransactionPrices(tx),
        fee: tx.fee != null ? tx.fee.toString() : null,
        platformFee: tx.platformFee != null ? tx.platformFee.toString() : null,
        merchantFee: tx.merchantFee != null ? tx.merchantFee.toString() : null,
        providerPrice: tx.providerPrice != null ? tx.providerPrice.toString() : null,
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
        const where: Prisma.PayoutWhereInput = { businessId };
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
          businessName: p.business.name,
          businessSlug: p.business.slug,
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
        req.log.error({ err }, "GET /api/v1/merchant/settlements");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/settlements/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const payout = await prisma.payout.findFirst({
        where: { id: req.params.id, businessId },
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
        },
      });
      if (!business) return errorEnvelope(reply, "Business not found.", 404);
      return successEnvelope(reply, {
        ...business,
        logoUrl: business.logoUrl ?? undefined,
        website: business.website ?? undefined,
        supportEmail: business.supportEmail ?? undefined,
        webhookUrl: business.webhookUrl ?? undefined,
        createdAt: business.createdAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/business");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/business", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
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
        },
      });
      return successEnvelope(reply, {
        ...business,
        logoUrl: business.logoUrl ?? undefined,
        website: business.website ?? undefined,
        supportEmail: business.supportEmail ?? undefined,
        webhookUrl: business.webhookUrl ?? undefined,
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
      const data = rows.map((k) => ({
        id: k.id,
        name: k.name,
        domains: k.domains ?? [],
        keyPrefix: k.keyPrefix,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
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
}
