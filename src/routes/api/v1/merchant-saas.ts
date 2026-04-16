/**
 * Multi-tenant SaaS: CSV exports, webhooks, CRM (MerchantCustomer), refund requests.
 */
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
import {
  PERMISSION_BUSINESS_READ,
  PERMISSION_BUSINESS_WRITE,
  PERMISSION_PAYOUTS_READ,
  PERMISSION_TRANSACTIONS_READ,
} from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { getMerchantEnvironmentOrThrow } from "../../../lib/merchant-environment.js";
import {
  requireMerchantRole,
  OWNER_ADMIN_DEV,
  OWNER_ADMIN_FINANCE,
  ALL_ROLES,
} from "../../../lib/merchant-rbac.js";

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsvRow(cells: string[]): string {
  return `${cells.map(csvEscape).join(",")}\r\n`;
}

const createWebhookBody = z.object({
  url: z.string().url().max(2048),
  secret: z.string().min(8).max(256).optional(),
  events: z.array(z.string().min(1).max(120)).min(1),
  isActive: z.boolean().optional(),
});

const patchWebhookBody = createWebhookBody.partial();

const createCrmBody = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(4).max(32).optional(),
  displayName: z.string().min(1).max(200).optional(),
  externalId: z.string().min(1).max(200).optional(),
  userId: z.string().uuid().optional(),
  notes: z.string().max(8000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const patchCrmBody = createCrmBody.partial();

const createRefundBody = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().min(1).max(32),
  reason: z.string().max(2000).optional(),
});

export function registerMerchantSaasRoutes(app: FastifyInstance): void {
  app.get(
    "/exports/transactions.csv",
    async (
      req: FastifyRequest<{
        Querystring: { from?: string; to?: string; status?: string; type?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        if (!requireMerchantRole(req, reply, OWNER_ADMIN_FINANCE)) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const from = req.query.from?.trim();
        const to = req.query.to?.trim();
        const status = req.query.status?.trim();
        const type = req.query.type?.trim();
        const where: Prisma.TransactionWhereInput = { businessId, environment };
        if (status) {
          where.status = status as Prisma.TransactionWhereInput["status"];
        }
        if (type) {
          where.type = type as Prisma.TransactionWhereInput["type"];
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
        const rows = await prisma.transaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 50_000,
        });
        const header = toCsvRow([
          "id",
          "createdAt",
          "environment",
          "status",
          "type",
          "f_chain",
          "t_chain",
          "f_token",
          "t_token",
          "f_amount",
          "t_amount",
          "fee",
          "platformFee",
          "merchantFee",
          "feeInUsd",
          "fromIdentifier",
          "toIdentifier",
        ]);
        let body = header;
        for (const t of rows) {
          body += toCsvRow([
            t.id,
            t.createdAt.toISOString(),
            t.environment,
            String(t.status),
            String(t.type),
            t.f_chain,
            t.t_chain,
            t.f_token,
            t.t_token,
            t.f_amount.toString(),
            t.t_amount.toString(),
            t.fee != null ? t.fee.toString() : "",
            t.platformFee != null ? t.platformFee.toString() : "",
            t.merchantFee != null ? t.merchantFee.toString() : "",
            t.feeInUsd != null ? t.feeInUsd.toString() : "",
            t.fromIdentifier ?? "",
            t.toIdentifier ?? "",
          ]);
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", 'attachment; filename="transactions.csv"')
          .send(body);
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/exports/transactions.csv");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get(
    "/exports/settlements.csv",
    async (req: FastifyRequest<{ Querystring: { from?: string; to?: string; status?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
        if (!requireMerchantRole(req, reply, OWNER_ADMIN_FINANCE)) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const from = req.query.from?.trim();
        const to = req.query.to?.trim();
        const status = req.query.status?.trim();
        const where: Prisma.PayoutWhereInput = { businessId, environment };
        if (status && status !== "all") {
          where.status = status as Prisma.PayoutWhereInput["status"];
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
        const rows = await prisma.payout.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 50_000,
          include: { method: { select: { id: true, type: true, currency: true } } },
        });
        const header = toCsvRow([
          "id",
          "createdAt",
          "environment",
          "status",
          "amount",
          "fee",
          "currency",
          "reference",
          "batchId",
          "methodId",
          "methodType",
        ]);
        let body = header;
        for (const p of rows) {
          body += toCsvRow([
            p.id,
            p.createdAt.toISOString(),
            p.environment,
            String(p.status),
            p.amount.toString(),
            p.fee.toString(),
            p.currency,
            p.reference ?? "",
            p.batchId ?? "",
            p.methodId,
            p.method.type,
          ]);
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", 'attachment; filename="settlements.csv"')
          .send(body);
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/exports/settlements.csv");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/webhooks/endpoints", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, ALL_ROLES)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const rows = await prisma.webhookEndpoint.findMany({
        where: { businessId, environment },
        orderBy: { createdAt: "desc" },
      });
      const data = rows.map((webhookEndpoint) => ({
        id: webhookEndpoint.id,
        url: webhookEndpoint.url,
        events: webhookEndpoint.events,
        isActive: webhookEndpoint.isActive,
        hasSecret: Boolean(webhookEndpoint.secret),
        createdAt: webhookEndpoint.createdAt.toISOString(),
        updatedAt: webhookEndpoint.updatedAt.toISOString(),
      }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/webhooks/endpoints");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/webhooks/endpoints", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = createWebhookBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      const created = await prisma.webhookEndpoint.create({
        data: {
          businessId,
          environment,
          url: parsed.data.url,
          secret: parsed.data.secret,
          events: parsed.data.events,
          isActive: parsed.data.isActive ?? true,
        },
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: created.id,
          url: created.url,
          events: created.events,
          isActive: created.isActive,
          hasSecret: Boolean(created.secret),
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/webhooks/endpoints");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/webhooks/endpoints/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = patchWebhookBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ success: false, error: "No fields to update." });
      }
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id: req.params.id, businessId, environment },
      });
      if (!existing) return errorEnvelope(reply, "Webhook endpoint not found.", 404);
      const updated = await prisma.webhookEndpoint.update({
        where: { id: req.params.id },
        data: {
          url: parsed.data.url,
          secret: parsed.data.secret,
          events: parsed.data.events,
          isActive: parsed.data.isActive,
        },
      });
      return successEnvelope(reply, {
        id: updated.id,
        url: updated.url,
        events: updated.events,
        isActive: updated.isActive,
        hasSecret: Boolean(updated.secret),
        updatedAt: updated.updatedAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/webhooks/endpoints/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/webhooks/deliveries",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; endpointId?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        if (!requireMerchantRole(req, reply, ALL_ROLES)) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const endpointId = req.query.endpointId?.trim();
        const endpointWhere: Prisma.WebhookEndpointWhereInput = {
          businessId,
          environment,
          ...(endpointId ? { id: endpointId } : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.webhookDeliveryLog.findMany({
            where: { endpoint: endpointWhere },
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { endpoint: { select: { id: true, url: true } } },
          }),
          prisma.webhookDeliveryLog.count({ where: { endpoint: endpointWhere } }),
        ]);
        const data = rows.map((deliveryLog) => ({
          id: deliveryLog.id,
          endpointId: deliveryLog.endpointId,
          endpointUrl: deliveryLog.endpoint.url,
          eventType: deliveryLog.eventType,
          status: deliveryLog.status,
          httpStatus: deliveryLog.httpStatus,
          attemptCount: deliveryLog.attemptCount,
          lastAttemptAt: deliveryLog.lastAttemptAt?.toISOString() ?? null,
          nextRetryAt: deliveryLog.nextRetryAt?.toISOString() ?? null,
          transactionId: deliveryLog.transactionId,
          createdAt: deliveryLog.createdAt.toISOString(),
          payload: deliveryLog.payload,
          responseBodyPreview:
            deliveryLog.responseBody != null && deliveryLog.responseBody.length > 500
              ? `${deliveryLog.responseBody.slice(0, 500)}…`
              : deliveryLog.responseBody,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/webhooks/deliveries");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post("/webhooks/deliveries/:id/retry", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const log = await prisma.webhookDeliveryLog.findFirst({
        where: {
          id: req.params.id,
          endpoint: { businessId, environment },
        },
        include: { endpoint: true },
      });
      if (!log) return errorEnvelope(reply, "Delivery not found.", 404);
      await prisma.webhookDeliveryLog.update({
        where: { id: log.id },
        data: {
          status: "RETRYING",
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          nextRetryAt: new Date(Date.now() + 60_000),
        },
      });
      return successEnvelope(reply, {
        queued: true,
        message: "Retry scheduled; worker integration pending.",
        deliveryId: log.id,
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/webhooks/deliveries/:id/retry");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/crm/customers",
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; q?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        if (!requireMerchantRole(req, reply, ALL_ROLES)) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const q = req.query.q?.trim();
        const where: Prisma.MerchantCustomerWhereInput = { businessId, environment };
        if (q) {
          where.OR = [
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { externalId: { contains: q, mode: "insensitive" } },
          ];
        }
        const [rows, total] = await Promise.all([
          prisma.merchantCustomer.findMany({
            where,
            skip,
            take: limit,
            orderBy: { updatedAt: "desc" },
          }),
          prisma.merchantCustomer.count({ where }),
        ]);
        const data = rows.map((crmCustomer) => ({
          id: crmCustomer.id,
          email: crmCustomer.email,
          phone: crmCustomer.phone,
          displayName: crmCustomer.displayName,
          externalId: crmCustomer.externalId,
          userId: crmCustomer.userId,
          totalSpend: crmCustomer.totalSpend.toString(),
          orderCount: crmCustomer.orderCount,
          notes: crmCustomer.notes,
          metadata: crmCustomer.metadata,
          firstSeenAt: crmCustomer.firstSeenAt?.toISOString() ?? null,
          lastActivityAt: crmCustomer.lastActivityAt?.toISOString() ?? null,
          createdAt: crmCustomer.createdAt.toISOString(),
          updatedAt: crmCustomer.updatedAt.toISOString(),
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/crm/customers");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post("/crm/customers", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, ALL_ROLES)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = createCrmBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      if (!parsed.data.email && !parsed.data.phone && !parsed.data.userId) {
        return reply.status(400).send({
          success: false,
          error: "Provide at least one of email, phone, or userId.",
        });
      }
      const created = await prisma.merchantCustomer.create({
        data: {
          businessId,
          environment,
          email: parsed.data.email,
          phone: parsed.data.phone,
          displayName: parsed.data.displayName,
          externalId: parsed.data.externalId,
          userId: parsed.data.userId,
          notes: parsed.data.notes,
          metadata:
            parsed.data.metadata != null
              ? (JSON.parse(JSON.stringify(parsed.data.metadata)) as Prisma.InputJsonValue)
              : undefined,
        },
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: created.id,
          email: created.email,
          phone: created.phone,
          displayName: created.displayName,
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/crm/customers");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/crm/customers/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, ALL_ROLES)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = patchCrmBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ success: false, error: "No fields to update." });
      }
      const existing = await prisma.merchantCustomer.findFirst({
        where: { id: req.params.id, businessId, environment },
      });
      if (!existing) return errorEnvelope(reply, "Customer not found.", 404);
      const updated = await prisma.merchantCustomer.update({
        where: { id: req.params.id },
        data: {
          email: parsed.data.email,
          phone: parsed.data.phone,
          displayName: parsed.data.displayName,
          externalId: parsed.data.externalId,
          userId: parsed.data.userId,
          notes: parsed.data.notes,
          metadata:
            parsed.data.metadata !== undefined
              ? (JSON.parse(JSON.stringify(parsed.data.metadata)) as Prisma.InputJsonValue)
              : undefined,
        },
      });
      return successEnvelope(reply, {
        id: updated.id,
        email: updated.email,
        phone: updated.phone,
        displayName: updated.displayName,
        notes: updated.notes,
        updatedAt: updated.updatedAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/crm/customers/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/transactions/:id/refunds", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_FINANCE)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parsed = createRefundBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      }
      const tx = await prisma.transaction.findFirst({
        where: { id: req.params.id, businessId, environment },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found.", 404);
      if (tx.status !== "COMPLETED") {
        return reply.status(400).send({
          success: false,
          error: "Only completed transactions can be refunded.",
          code: "INVALID_TX_STATUS",
        });
      }
      const refund = await prisma.refund.create({
        data: {
          businessId,
          environment,
          transactionId: tx.id,
          amount: parsed.data.amount,
          currency: parsed.data.currency,
          reason: parsed.data.reason,
          status: "PENDING",
          requestedByUserId: req.businessPortalTenant?.userId ?? undefined,
        },
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: refund.id,
          transactionId: refund.transactionId,
          amount: refund.amount.toString(),
          currency: refund.currency,
          status: refund.status,
          message: "Refund queued; crypto transfer execution is processed asynchronously.",
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/transactions/:id/refunds");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
