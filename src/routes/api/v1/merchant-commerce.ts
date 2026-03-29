/**
 * Merchant commerce: catalog products and pay pages (PaymentLink model).
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "../../../../prisma/generated/prisma/client.js";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import {
  parsePagination,
  successEnvelope,
  successEnvelopeWithMeta,
  errorEnvelope,
} from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import { PERMISSION_BUSINESS_READ, PERMISSION_BUSINESS_WRITE } from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { getMerchantEnvironmentOrThrow } from "../../../lib/merchant-environment.js";
import { getFiatQuote, isExchangeRateConfigured } from "../../../services/exchange-rate.service.js";

const MerchantFiatQuoteBodySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.coerce.number().positive().optional(),
});

const createProductBody = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(8000).optional(),
  type: z.enum(["DIGITAL", "PHYSICAL", "SERVICE"]).optional(),
  price: z.coerce.number().nonnegative(),
  currency: z.string().min(1).max(16).optional(),
  imageUrl: z.string().url().max(2048).nullable().optional(),
  isActive: z.boolean().optional(),
});

const patchProductBody = createProductBody.partial();

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase alphanumeric with single hyphens");

const createPayPageBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  slug: slugSchema.optional(),
  type: z.enum(["STANDARD", "PRODUCT", "DONATION"]).optional(),
  productId: z.string().uuid().nullable().optional(),
  amount: z.union([z.coerce.number().positive(), z.null()]).optional(),
  currency: z.string().min(1).max(16).optional(),
  chargeKind: z.enum(["FIAT", "CRYPTO"]).optional(),
  isActive: z.boolean().optional(),
});

const patchPayPageBody = createPayPageBody.partial().extend({
  slug: slugSchema.optional(),
});

function serializeProduct(p: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  businessId: string;
  name: string;
  description: string | null;
  type: string;
  price: { toString(): string };
  currency: string;
  imageUrl: string | null;
  isActive: boolean;
  isArchived: boolean;
}) {
  return {
    id: p.id,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    businessId: p.businessId,
    name: p.name,
    description: p.description ?? undefined,
    type: p.type,
    price: p.price.toString(),
    currency: p.currency,
    imageUrl: p.imageUrl ?? undefined,
    isActive: p.isActive,
    isArchived: p.isArchived,
  };
}

function serializePayPage(p: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  businessId: string;
  title: string;
  description: string | null;
  slug: string;
  publicCode: string;
  type: string;
  productId: string | null;
  amount: { toString(): string } | null;
  currency: string;
  chargeKind: string;
  isActive: boolean;
  views: number;
}) {
  return {
    id: p.id,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    businessId: p.businessId,
    title: p.title,
    description: p.description ?? undefined,
    slug: p.slug,
    publicCode: p.publicCode,
    type: p.type,
    productId: p.productId ?? undefined,
    amount: p.amount != null ? p.amount.toString() : null,
    currency: p.currency,
    chargeKind: p.chargeKind,
    isActive: p.isActive,
    views: p.views,
  };
}

function randomPaySlugCandidate(): string {
  return `pay-${randomBytes(6).toString("hex")}`;
}

async function allocateUniquePaymentLinkSlug(candidate: string): Promise<string> {
  let base = candidate.slice(0, 120);
  let n = 0;
  for (;;) {
    const slug = n === 0 ? base : `${base}-${n}`.slice(0, 120);
    const hit = await prisma.paymentLink.findUnique({ where: { slug } });
    if (!hit) return slug;
    n += 1;
    if (n > 50) {
      base = randomPaySlugCandidate();
      n = 0;
    }
  }
}

async function allocateUniquePaymentLinkPublicCode(): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const code = randomBytes(6).toString("hex");
    const hit = await prisma.paymentLink.findUnique({ where: { publicCode: code } });
    if (!hit) return code;
  }
  throw new Error("PUBLIC_CODE_ALLOCATION_FAILED");
}

export function registerMerchantCommerceRoutes(app: FastifyInstance): void {
  app.get(
    "/products",
    async (
      req: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          q?: string;
          includeArchived?: string;
          status?: string;
          type?: string;
        };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const q = req.query.q?.trim();
        const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
        const statusFilter = req.query.status?.trim().toLowerCase();
        const typeFilter = req.query.type?.trim().toUpperCase();
        const andParts: Prisma.ProductWhereInput[] = [{ businessId, environment }];
        if (statusFilter === "active") {
          andParts.push({ isArchived: false, isActive: true });
        } else if (statusFilter === "archived") {
          andParts.push({ OR: [{ isArchived: true }, { isActive: false }] });
        } else if (!includeArchived) {
          andParts.push({ isArchived: false });
        }
        if (
          typeFilter === "DIGITAL" ||
          typeFilter === "PHYSICAL" ||
          typeFilter === "SERVICE"
        ) {
          andParts.push({ type: typeFilter });
        }
        if (q) {
          andParts.push({
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          });
        }
        const where: Prisma.ProductWhereInput =
          andParts.length === 1 ? andParts[0]! : { AND: andParts };
        const [rows, total] = await Promise.all([
          prisma.product.findMany({
            where,
            skip,
            take: limit,
            orderBy: { updatedAt: "desc" },
          }),
          prisma.product.count({ where }),
        ]);
        return successEnvelopeWithMeta(
          reply,
          rows.map(serializeProduct),
          { page, limit, total }
        );
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/products");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post("/products", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = createProductBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      const b = parsed.data;
      const created = await prisma.product.create({
        data: {
          businessId,
          environment,
          name: b.name,
          description: b.description,
          type: b.type ?? "DIGITAL",
          price: b.price,
          currency: b.currency ?? "USD",
          imageUrl: b.imageUrl ?? undefined,
          isActive: b.isActive ?? true,
        },
      });
      return reply.status(201).send({ success: true, data: serializeProduct(created) });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/products");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/products/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = patchProductBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ success: false, error: "No fields to update." });
      }
      const existing = await prisma.product.findFirst({
        where: { id: req.params.id, businessId, environment },
      });
      if (!existing) return errorEnvelope(reply, "Product not found.", 404);
      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data: parsed.data,
      });
      return successEnvelope(reply, serializeProduct(updated));
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/products/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/pay-pages",
    async (
      req: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          q?: string;
          active?: string;
          amountType?: string;
        };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const q = req.query.q?.trim();
        const activeQ = req.query.active?.trim().toLowerCase();
        const amountType = req.query.amountType?.trim().toLowerCase();
        const zero = new Prisma.Decimal(0);
        const andParts: Prisma.PaymentLinkWhereInput[] = [{ businessId, environment }];
        if (q) {
          andParts.push({
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
            ],
          });
        }
        if (activeQ === "true") {
          andParts.push({ isActive: true });
        } else if (activeQ === "false") {
          andParts.push({ isActive: false });
        }
        if (amountType === "fixed") {
          andParts.push({
            AND: [{ amount: { not: null } }, { amount: { gt: zero } }],
          });
        } else if (amountType === "open") {
          andParts.push({
            OR: [{ amount: null }, { amount: { lte: zero } }],
          });
        }
        const where: Prisma.PaymentLinkWhereInput =
          andParts.length === 1 ? andParts[0]! : { AND: andParts };
        const [rows, total] = await Promise.all([
          prisma.paymentLink.findMany({
            where,
            skip,
            take: limit,
            orderBy: { updatedAt: "desc" },
            include: { product: { select: { id: true, name: true } } },
          }),
          prisma.paymentLink.count({ where }),
        ]);
        const data = rows.map((r) => ({
          ...serializePayPage(r),
          product: r.product ? { id: r.product.id, name: r.product.name } : undefined,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/pay-pages");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post("/pay-pages", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = createPayPageBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      const b = parsed.data;
      if (b.productId) {
        const p = await prisma.product.findFirst({
          where: { id: b.productId, businessId, environment, isArchived: false },
        });
        if (!p) {
          return reply.status(400).send({ success: false, error: "productId must belong to this business." });
        }
      }
      const slug =
        b.slug != null && b.slug.trim().length > 0
          ? b.slug.trim()
          : await allocateUniquePaymentLinkSlug(randomPaySlugCandidate());
      const publicCode = await allocateUniquePaymentLinkPublicCode();
      const created = await prisma.paymentLink.create({
        data: {
          businessId,
          environment,
          title: b.title,
          description: b.description,
          slug,
          publicCode,
          type: b.type ?? "STANDARD",
          productId: b.productId ?? undefined,
          amount: b.amount ?? undefined,
          currency: b.currency ?? "USD",
          chargeKind: b.chargeKind ?? "FIAT",
          isActive: b.isActive ?? true,
        },
      });
      return reply.status(201).send({ success: true, data: serializePayPage(created) });
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "P2002") {
        return reply.status(409).send({ success: false, error: "Slug already in use.", code: "SLUG_TAKEN" });
      }
      req.log.error({ err }, "POST /api/v1/merchant/pay-pages");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/pay-pages/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = patchPayPageBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ success: false, error: "No fields to update." });
      }
      const existing = await prisma.paymentLink.findFirst({
        where: { id: req.params.id, businessId, environment },
      });
      if (!existing) return errorEnvelope(reply, "Pay page not found.", 404);
      const nextProductId = parsed.data.productId;
      if (nextProductId) {
        const p = await prisma.product.findFirst({
          where: { id: nextProductId, businessId, environment, isArchived: false },
        });
        if (!p) {
          return reply.status(400).send({ success: false, error: "productId must belong to this business." });
        }
      }
      const patch = parsed.data;
      const data: Record<string, unknown> = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.productId !== undefined
          ? { productId: patch.productId === null ? null : patch.productId }
          : {}),
        ...(patch.amount !== undefined
          ? { amount: patch.amount === null ? null : patch.amount }
          : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.chargeKind !== undefined ? { chargeKind: patch.chargeKind } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      };
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ success: false, error: "No fields to update." });
      }
      const updated = await prisma.paymentLink.update({
        where: { id: req.params.id },
        data: data as Prisma.PaymentLinkUpdateInput,
      });
      return successEnvelope(reply, serializePayPage(updated));
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "P2002") {
        return reply.status(409).send({ success: false, error: "Slug already in use.", code: "SLUG_TAKEN" });
      }
      req.log.error({ err }, "PATCH /api/v1/merchant/pay-pages/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/rates/fiat", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      if (!isExchangeRateConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Fiat rates are not configured on the server.",
          code: "RATES_UNAVAILABLE",
        });
      }
      const parsed = MerchantFiatQuoteBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { from, to, amount } = parsed.data;
      const data = await getFiatQuote({
        from: from.trim().toUpperCase(),
        to: to.trim().toUpperCase(),
        amount,
      });
      return successEnvelope(reply, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Quote failed.";
      req.log.warn({ err }, "POST /api/v1/merchant/rates/fiat");
      return errorEnvelope(reply, message, 502);
    }
  });
}
