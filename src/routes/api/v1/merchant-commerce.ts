/**
 * Merchant commerce: catalog products and pay pages (PaymentLink model).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "../../../../prisma/generated/prisma/client.js";
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

const createPayPageBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase alphanumeric with single hyphens"),
  type: z.enum(["STANDARD", "PRODUCT", "DONATION"]).optional(),
  productId: z.string().uuid().nullable().optional(),
  amount: z.union([z.coerce.number().positive(), z.null()]).optional(),
  currency: z.string().min(1).max(16).optional(),
  isActive: z.boolean().optional(),
});

const patchPayPageBody = createPayPageBody.partial().extend({
  slug: createPayPageBody.shape.slug.optional(),
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
  type: string;
  productId: string | null;
  amount: { toString(): string } | null;
  currency: string;
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
    type: p.type,
    productId: p.productId ?? undefined,
    amount: p.amount != null ? p.amount.toString() : null,
    currency: p.currency,
    isActive: p.isActive,
    views: p.views,
  };
}

export function registerMerchantCommerceRoutes(app: FastifyInstance): void {
  app.get(
    "/products",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; q?: string; includeArchived?: string };
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
        const where: Prisma.ProductWhereInput = { businessId, environment };
        if (!includeArchived) {
          where.isArchived = false;
        }
        if (q) {
          where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ];
        }
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
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; q?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const q = req.query.q?.trim();
        const where: Prisma.PaymentLinkWhereInput = { businessId, environment };
        if (q) {
          where.OR = [
            { title: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ];
        }
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
      const created = await prisma.paymentLink.create({
        data: {
          businessId,
          environment,
          title: b.title,
          description: b.description,
          slug: b.slug,
          type: b.type ?? "STANDARD",
          productId: b.productId ?? undefined,
          amount: b.amount ?? undefined,
          currency: b.currency ?? "USD",
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
      const updated = await prisma.paymentLink.update({
        where: { id: req.params.id },
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          slug: parsed.data.slug,
          type: parsed.data.type,
          productId: parsed.data.productId === null ? null : parsed.data.productId,
          amount: parsed.data.amount === null ? null : parsed.data.amount,
          currency: parsed.data.currency,
          isActive: parsed.data.isActive,
        },
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
}
