/**
 * Multi-tenant SaaS: CSV exports, webhooks, CRM (MerchantCustomer), refund requests.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
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
import { merchantWebhookEventTypeSchema } from "../../../lib/merchant-webhook-events.js";

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsvRow(cells: string[]): string {
  return `${cells.map(csvEscape).join(",")}\r\n`;
}

const createWebhookBody = z.object({
  displayName: z.string().min(1).max(120),
  url: z.string().url().max(2048),
  secret: z.string().min(8).max(256).optional(),
  events: z.array(merchantWebhookEventTypeSchema).min(1),
  isActive: z.boolean().optional(),
  protocolVersion: z.enum(["v1"]).optional(),
});

const patchWebhookBody = createWebhookBody.partial();

function generateMerchantWebhookSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

const WEBHOOK_DATE_RANGE_MAX_DAYS = 90;

function parseIsoDateInput(s: string | undefined): Date | undefined {
  const t = s?.trim();
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

type WebhookDateRangeOk = { ok: true; gte: Date; lte: Date };
type WebhookDateRangeErr = { ok: false; error: string };
type WebhookDateRange = WebhookDateRangeOk | WebhookDateRangeErr;

/** When both from and to are omitted, defaults to the last `defaultDays` (inclusive of now as lte). */
function resolveWebhookDateRangeForSummary(
  fromStr: string | undefined,
  toStr: string | undefined,
  defaultDays: number
): WebhookDateRange {
  const now = new Date();
  const fromInput = parseIsoDateInput(fromStr);
  const toInput = parseIsoDateInput(toStr);
  if (fromStr?.trim() && !fromInput) return { ok: false, error: "Invalid from date." };
  if (toStr?.trim() && !toInput) return { ok: false, error: "Invalid to date." };
  let gte: Date;
  let lte: Date;
  if (!fromInput && !toInput) {
    lte = now;
    gte = new Date(now.getTime() - defaultDays * 86_400_000);
  } else {
    gte = fromInput ?? new Date(0);
    lte = toInput ?? now;
  }
  if (gte.getTime() > lte.getTime()) {
    return { ok: false, error: "from must be before or equal to to." };
  }
  const spanDays = (lte.getTime() - gte.getTime()) / 86_400_000;
  if (spanDays > WEBHOOK_DATE_RANGE_MAX_DAYS) {
    return { ok: false, error: `Date range must not exceed ${WEBHOOK_DATE_RANGE_MAX_DAYS} days.` };
  }
  return { ok: true, gte, lte };
}

type DeliveriesDateOk = { ok: true; createdAt?: Prisma.DateTimeFilter };
type DeliveriesDateResult = DeliveriesDateOk | WebhookDateRangeErr;

/** Optional date filter for deliveries list: if both omitted, no createdAt filter. */
function resolveWebhookDateRangeForDeliveriesList(
  fromStr: string | undefined,
  toStr: string | undefined
): DeliveriesDateResult {
  if (!fromStr?.trim() && !toStr?.trim()) return { ok: true };
  const now = new Date();
  const fromInput = parseIsoDateInput(fromStr);
  const toInput = parseIsoDateInput(toStr);
  if (fromStr?.trim() && !fromInput) return { ok: false, error: "Invalid from date." };
  if (toStr?.trim() && !toInput) return { ok: false, error: "Invalid to date." };
  const gte = fromInput ?? new Date(now.getTime() - WEBHOOK_DATE_RANGE_MAX_DAYS * 86_400_000);
  const lte = toInput ?? now;
  if (gte.getTime() > lte.getTime()) {
    return { ok: false, error: "from must be before or equal to to." };
  }
  const spanDays = (lte.getTime() - gte.getTime()) / 86_400_000;
  if (spanDays > WEBHOOK_DATE_RANGE_MAX_DAYS) {
    return { ok: false, error: `Date range must not exceed ${WEBHOOK_DATE_RANGE_MAX_DAYS} days.` };
  }
  return { ok: true, createdAt: { gte, lte } };
}

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
        displayName: webhookEndpoint.displayName,
        protocolVersion: webhookEndpoint.protocolVersion,
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
      const secret =
        parsed.data.secret != null && parsed.data.secret.length > 0
          ? parsed.data.secret
          : generateMerchantWebhookSigningSecret();
      const created = await prisma.webhookEndpoint.create({
        data: {
          businessId,
          environment,
          displayName: parsed.data.displayName,
          protocolVersion: parsed.data.protocolVersion ?? "v1",
          url: parsed.data.url,
          secret,
          events: parsed.data.events,
          isActive: parsed.data.isActive ?? true,
        },
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: created.id,
          displayName: created.displayName,
          protocolVersion: created.protocolVersion,
          url: created.url,
          events: created.events,
          isActive: created.isActive,
          hasSecret: Boolean(created.secret),
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
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
      const d = parsed.data;
      const secretForDb =
        d.secret !== undefined
          ? d.secret
          : !existing.secret
            ? generateMerchantWebhookSigningSecret()
            : undefined;
      const updated = await prisma.webhookEndpoint.update({
        where: { id: req.params.id },
        data: {
          ...(d.displayName !== undefined ? { displayName: d.displayName } : {}),
          ...(d.protocolVersion !== undefined ? { protocolVersion: d.protocolVersion } : {}),
          ...(d.url !== undefined ? { url: d.url } : {}),
          ...(secretForDb !== undefined ? { secret: secretForDb } : {}),
          ...(d.events !== undefined ? { events: d.events } : {}),
          ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
        },
      });
      return successEnvelope(reply, {
        id: updated.id,
        displayName: updated.displayName,
        protocolVersion: updated.protocolVersion,
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

  app.delete("/webhooks/endpoints/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const existing = await prisma.webhookEndpoint.findFirst({
        where: { id: req.params.id, businessId, environment },
      });
      if (!existing) return errorEnvelope(reply, "Webhook endpoint not found.", 404);
      await prisma.webhookEndpoint.delete({ where: { id: req.params.id } });
      return successEnvelope(reply, { deleted: true, id: req.params.id });
    } catch (err) {
      req.log.error({ err }, "DELETE /api/v1/merchant/webhooks/endpoints/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/webhooks/endpoints/:id/summary",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: { from?: string; to?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        if (!requireMerchantRole(req, reply, ALL_ROLES)) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const endpointId = req.params.id?.trim();
        if (!endpointId) return errorEnvelope(reply, "Missing endpoint id.", 400);

        const endpoint = await prisma.webhookEndpoint.findFirst({
          where: { id: endpointId, businessId, environment },
          select: { id: true },
        });
        if (!endpoint) return errorEnvelope(reply, "Webhook endpoint not found.", 404);

        const range = resolveWebhookDateRangeForSummary(req.query.from, req.query.to, 30);
        if (!range.ok) return errorEnvelope(reply, range.error, 400);
        const { gte, lte } = range;

        const baseWhere: Prisma.WebhookDeliveryLogWhereInput = {
          endpointId,
          createdAt: { gte, lte },
        };

        const [totalDeliveries, failedDeliveries, lastRow, avgAgg, bucketRows, latencyDayRows] =
          await Promise.all([
            prisma.webhookDeliveryLog.count({ where: baseWhere }),
            prisma.webhookDeliveryLog.count({
              where: {
                ...baseWhere,
                OR: [
                  { status: "FAILED" },
                  {
                    AND: [
                      { httpStatus: { not: null } },
                      {
                        OR: [{ httpStatus: { lt: 200 } }, { httpStatus: { gte: 300 } }],
                      },
                    ],
                  },
                ],
              },
            }),
            prisma.webhookDeliveryLog.findFirst({
              where: baseWhere,
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            }),
            prisma.webhookDeliveryLog.aggregate({
              where: { ...baseWhere, durationMs: { not: null } },
              _avg: { durationMs: true },
            }),
            prisma.$queryRaw<
              { d: Date; success_count: bigint; failure_count: bigint }[]
            >(Prisma.sql`
              SELECT (wdl."createdAt" AT TIME ZONE 'UTC')::date AS d,
                COUNT(*) FILTER (
                  WHERE wdl.status = 'DELIVERED'
                    AND (wdl."httpStatus" IS NULL OR (wdl."httpStatus" >= 200 AND wdl."httpStatus" < 300))
                )::bigint AS success_count,
                COUNT(*) FILTER (
                  WHERE wdl.status = 'FAILED'
                    OR (wdl."httpStatus" IS NOT NULL AND (wdl."httpStatus" < 200 OR wdl."httpStatus" >= 300))
                )::bigint AS failure_count
              FROM "WebhookDeliveryLog" wdl
              INNER JOIN "WebhookEndpoint" we ON we.id = wdl."endpointId"
              WHERE wdl."endpointId" = ${endpointId}
                AND we."businessId" = ${businessId}
                AND we.environment::text = ${environment}
                AND wdl."createdAt" >= ${gte}
                AND wdl."createdAt" <= ${lte}
              GROUP BY 1
              ORDER BY 1 ASC
            `),
            prisma.$queryRaw<
              { d: Date; min_ms: bigint | null; avg_ms: number | null; max_ms: bigint | null }[]
            >(Prisma.sql`
              SELECT (wdl."createdAt" AT TIME ZONE 'UTC')::date AS d,
                MIN(wdl."durationMs")::bigint AS min_ms,
                AVG(wdl."durationMs")::float AS avg_ms,
                MAX(wdl."durationMs")::bigint AS max_ms
              FROM "WebhookDeliveryLog" wdl
              INNER JOIN "WebhookEndpoint" we ON we.id = wdl."endpointId"
              WHERE wdl."endpointId" = ${endpointId}
                AND we."businessId" = ${businessId}
                AND we.environment::text = ${environment}
                AND wdl."createdAt" >= ${gte}
                AND wdl."createdAt" <= ${lte}
                AND wdl."durationMs" IS NOT NULL
              GROUP BY 1
              ORDER BY 1 ASC
            `),
          ]);

        const errorRatePct =
          totalDeliveries === 0 ? 0 : Math.round((100 * failedDeliveries) / totalDeliveries);
        const avgLatencyMs =
          avgAgg._avg.durationMs != null && !Number.isNaN(avgAgg._avg.durationMs)
            ? Math.round(avgAgg._avg.durationMs)
            : null;

        const buckets = bucketRows.map((r) => ({
          date: r.d.toISOString().slice(0, 10),
          successCount: Number(r.success_count),
          failureCount: Number(r.failure_count),
        }));

        const latencyByDay =
          latencyDayRows.length > 0
            ? latencyDayRows.map((r) => ({
                date: r.d.toISOString().slice(0, 10),
                minMs: r.min_ms != null ? Number(r.min_ms) : 0,
                avgMs: r.avg_ms != null ? Math.round(r.avg_ms) : 0,
                maxMs: r.max_ms != null ? Number(r.max_ms) : 0,
              }))
            : null;

        return successEnvelope(reply, {
          endpointId,
          from: gte.toISOString(),
          to: lte.toISOString(),
          totalDeliveries,
          failedDeliveries,
          errorRatePct,
          lastDeliveryAt: lastRow?.createdAt.toISOString() ?? null,
          avgLatencyMs,
          buckets,
          latencyByDay,
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/webhooks/endpoints/:id/summary");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post(
    "/webhooks/endpoints/:id/reveal-secret",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
        if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const endpointId = req.params.id?.trim();
        if (!endpointId) return errorEnvelope(reply, "Missing endpoint id.", 400);

        const row = await prisma.webhookEndpoint.findFirst({
          where: { id: endpointId, businessId, environment },
          select: { secret: true },
        });
        if (!row) return errorEnvelope(reply, "Webhook endpoint not found.", 404);
        if (!row.secret) {
          return errorEnvelope(
            reply,
            "No signing secret stored for this destination yet. Save the destination once to provision a secret, then try again.",
            400
          );
        }
        return successEnvelope(reply, { secret: row.secret });
      } catch (err) {
        req.log.error({ err }, "POST /api/v1/merchant/webhooks/endpoints/:id/reveal-secret");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get(
    "/webhooks/deliveries",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; endpointId?: string; from?: string; to?: string };
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
        const dateRes = resolveWebhookDateRangeForDeliveriesList(req.query.from, req.query.to);
        if (!dateRes.ok) return errorEnvelope(reply, dateRes.error, 400);

        const endpointWhere: Prisma.WebhookEndpointWhereInput = {
          businessId,
          environment,
          ...(endpointId ? { id: endpointId } : {}),
        };
        const deliveryWhere: Prisma.WebhookDeliveryLogWhereInput = {
          endpoint: endpointWhere,
          ...(dateRes.createdAt ? { createdAt: dateRes.createdAt } : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.webhookDeliveryLog.findMany({
            where: deliveryWhere,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { endpoint: { select: { id: true, url: true } } },
          }),
          prisma.webhookDeliveryLog.count({ where: deliveryWhere }),
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
          durationMs: deliveryLog.durationMs,
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
