/**
 * Additional merchant v1 routes: payment links, customers, team, payout methods, developer logs, API key revoke.
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
  serializeTransactionPrices,
} from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import {
  PERMISSION_BUSINESS_READ,
  PERMISSION_BUSINESS_WRITE,
  PERMISSION_BUSINESS_MEMBERS_READ,
  PERMISSION_BUSINESS_MEMBERS_WRITE,
  PERMISSION_PAYOUTS_READ,
  PERMISSION_PAYOUTS_WRITE,
  PERMISSION_TRANSACTIONS_READ,
} from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { getMerchantEnvironmentOrThrow } from "../../../lib/merchant-environment.js";
import { requireMerchantRole, OWNER_ADMIN_DEV, OWNER_ADMIN_FINANCE } from "../../../lib/merchant-rbac.js";
import { getRequestLogs } from "../../../lib/request-log-store.js";
import { createPaymentRequest, CreatePaymentRequestBodySchema } from "../../../services/payment-request-create.service.js";
import {
  canManageTeamMembers,
  createBusinessMemberInvite,
  listBusinessMembers,
  listPendingInvites,
  revokeBusinessMemberInvite,
  updateMemberRole,
} from "../../../services/business-member-invite.service.js";
import { deactivateApiKeyForBusiness } from "../../../services/api-key.service.js";
import { buildPaymentRequestLink } from "../../../services/notification.service.js";
import type { BusinessRole, PayoutMethodType } from "../../../../prisma/generated/prisma/client.js";

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "DEVELOPER", "FINANCE", "SUPPORT"]),
});

const patchMemberBody = z.object({
  role: z.enum(["ADMIN", "DEVELOPER", "FINANCE", "SUPPORT"]),
});

const payoutMethodBody = z.object({
  type: z.enum(["BANK_ACCOUNT", "CRYPTO_WALLET", "MOBILE_MONEY"]),
  currency: z.string().min(1).max(16),
  details: z.record(z.string(), z.unknown()),
  isPrimary: z.boolean().optional(),
});

const patchPayoutMethodBody = z.object({
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

function viaApiKey(req: FastifyRequest): boolean {
  return Boolean(req.apiKey?.businessId);
}

export function registerMerchantExtendedRoutes(app: FastifyInstance): void {
  app.get(
    "/payment-requests",
    async (
      req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string } }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status?.trim();
        const where: Prisma.TransactionWhereInput = {
          businessId,
          environment,
          type: "REQUEST",
        };
        if (status) {
          where.status = status as "ACTIVE" | "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
        }
        const [txRows, total] = await Promise.all([
          prisma.transaction.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              request: { include: { claim: true } },
            },
          }),
          prisma.transaction.count({ where }),
        ]);
        const data = txRows.map((paymentTxn) => {
          const payLink =
            paymentTxn.request != null
              ? buildPaymentRequestLink(paymentTxn.request.linkId)
              : undefined;
          return {
            id: paymentTxn.request?.id,
            linkId: paymentTxn.request?.linkId,
            code: paymentTxn.request?.code,
            transactionId: paymentTxn.id,
            status: paymentTxn.status,
            payLink,
            createdAt: paymentTxn.createdAt.toISOString(),
            transaction: {
              ...paymentTxn,
              f_amount: paymentTxn.f_amount.toString(),
              t_amount: paymentTxn.t_amount.toString(),
              ...serializeTransactionPrices(paymentTxn),
            },
          };
        });
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/payment-requests");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.post("/payment-requests", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const parse = CreatePaymentRequestBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "Validation failed", details: parse.error.flatten() });
      }
      const data = await createPaymentRequest(parse.data, { businessId, environment });
      return reply.status(201).send({
        success: true,
        data: {
          id: data.id,
          code: data.code,
          linkId: data.linkId,
          transactionId: data.transactionId,
          claimId: data.claimId,
          claimCode: data.claimCode,
          payLink: data.payLink,
          notification: data.notification,
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/payment-requests");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/payment-requests/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const environment = getMerchantEnvironmentOrThrow(req);
      const requestRow = await prisma.request.findFirst({
        where: { id: req.params.id, transaction: { businessId, environment } },
        include: { transaction: true, claim: true },
      });
      if (!requestRow) return errorEnvelope(reply, "Payment link not found.", 404);
      const transaction = requestRow.transaction;
      const data = {
        ...requestRow,
        transaction: {
          ...transaction,
          f_amount: transaction.f_amount.toString(),
          t_amount: transaction.t_amount.toString(),
          ...serializeTransactionPrices(transaction),
        },
        claim: requestRow.claim
          ? {
              ...requestRow.claim,
              value: requestRow.claim.value.toString(),
              price: requestRow.claim.price.toString(),
            }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/payment-requests/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/customers",
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; q?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_TRANSACTIONS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const environment = getMerchantEnvironmentOrThrow(req);
        const { page, limit, skip } = parsePagination(req.query);
        const q = req.query.q?.trim();
        const searchSql =
          q && q.length > 0
            ? Prisma.sql`AND "fromIdentifier" ILIKE ${"%" + q.replace(/[%_\\]/g, "") + "%"}`
            : Prisma.empty;
        /**
         * Distinct counterparties: payer `fromIdentifier`, recipient `toIdentifier` (hosted checkout),
         * plus Claim.payerIdentifier when the linked transaction has no payer id.
         */
        const rows = await prisma.$queryRaw<
          { fromIdentifier: string; fromType: string | null; txCount: bigint; lastActivityAt: Date }[]
        >`
          WITH "txPayers" AS (
            SELECT "fromIdentifier" AS "identifier", "fromType"::text AS "fromType", COUNT(*)::bigint AS "cnt", MAX("createdAt") AS "lastAt"
            FROM "Transaction"
            WHERE "businessId" = ${businessId}
              AND "environment"::text = ${String(environment)}
              AND "fromIdentifier" IS NOT NULL
              AND TRIM("fromIdentifier") <> ''
            GROUP BY "fromIdentifier", "fromType"
          ),
          "txRecipients" AS (
            SELECT "toIdentifier" AS "identifier", "toType"::text AS "fromType", COUNT(*)::bigint AS "cnt", MAX("createdAt") AS "lastAt"
            FROM "Transaction"
            WHERE "businessId" = ${businessId}
              AND "environment"::text = ${String(environment)}
              AND "toIdentifier" IS NOT NULL
              AND TRIM("toIdentifier") <> ''
            GROUP BY "toIdentifier", "toType"
          ),
          "claimPayers" AS (
            SELECT TRIM(c."payerIdentifier") AS "identifier", 'EMAIL'::text AS "fromType", COUNT(*)::bigint AS "cnt", MAX(t."createdAt") AS "lastAt"
            FROM "Claim" c
            INNER JOIN "Request" r ON r."id" = c."requestId"
            INNER JOIN "Transaction" t ON t."id" = r."transactionId"
            WHERE r."businessId" = ${businessId}
              AND r."environment"::text = ${String(environment)}
              AND TRIM(c."payerIdentifier") <> ''
              AND (t."fromIdentifier" IS NULL OR TRIM(t."fromIdentifier") = '')
            GROUP BY TRIM(c."payerIdentifier")
          ),
          "combined" AS (
            SELECT * FROM "txPayers"
            UNION ALL
            SELECT * FROM "txRecipients"
            UNION ALL
            SELECT * FROM "claimPayers"
          ),
          "rolled" AS (
            SELECT "identifier" AS "fromIdentifier", "fromType", SUM("cnt")::bigint AS "txCount", MAX("lastAt") AS "lastActivityAt"
            FROM "combined"
            GROUP BY "identifier", "fromType"
          )
          SELECT "fromIdentifier", "fromType", "txCount", "lastActivityAt"
          FROM "rolled"
          WHERE 1=1
            ${searchSql}
          ORDER BY "lastActivityAt" DESC
          LIMIT ${limit} OFFSET ${skip}
        `;
        const countRows = await prisma.$queryRaw<{ c: bigint }[]>`
          WITH "txPayers" AS (
            SELECT "fromIdentifier" AS "identifier", "fromType"::text AS "fromType", COUNT(*)::bigint AS "cnt", MAX("createdAt") AS "lastAt"
            FROM "Transaction"
            WHERE "businessId" = ${businessId}
              AND "environment"::text = ${String(environment)}
              AND "fromIdentifier" IS NOT NULL
              AND TRIM("fromIdentifier") <> ''
            GROUP BY "fromIdentifier", "fromType"
          ),
          "txRecipients" AS (
            SELECT "toIdentifier" AS "identifier", "toType"::text AS "fromType", COUNT(*)::bigint AS "cnt", MAX("createdAt") AS "lastAt"
            FROM "Transaction"
            WHERE "businessId" = ${businessId}
              AND "environment"::text = ${String(environment)}
              AND "toIdentifier" IS NOT NULL
              AND TRIM("toIdentifier") <> ''
            GROUP BY "toIdentifier", "toType"
          ),
          "claimPayers" AS (
            SELECT TRIM(c."payerIdentifier") AS "identifier", 'EMAIL'::text AS "fromType", COUNT(*)::bigint AS "cnt", MAX(t."createdAt") AS "lastAt"
            FROM "Claim" c
            INNER JOIN "Request" r ON r."id" = c."requestId"
            INNER JOIN "Transaction" t ON t."id" = r."transactionId"
            WHERE r."businessId" = ${businessId}
              AND r."environment"::text = ${String(environment)}
              AND TRIM(c."payerIdentifier") <> ''
              AND (t."fromIdentifier" IS NULL OR TRIM(t."fromIdentifier") = '')
            GROUP BY TRIM(c."payerIdentifier")
          ),
          "combined" AS (
            SELECT * FROM "txPayers"
            UNION ALL
            SELECT * FROM "txRecipients"
            UNION ALL
            SELECT * FROM "claimPayers"
          ),
          "rolled" AS (
            SELECT "identifier" AS "fromIdentifier", "fromType", SUM("cnt")::bigint AS "txCount", MAX("lastAt") AS "lastActivityAt"
            FROM "combined"
            GROUP BY "identifier", "fromType"
          )
          SELECT COUNT(*)::bigint AS c FROM (
            SELECT 1 FROM "rolled" WHERE 1=1 ${searchSql}
          ) x
        `;
        const total = Number(countRows[0]?.c ?? 0);
        const data = rows.map((payerSummary) => ({
          identifier: payerSummary.fromIdentifier,
          identityType: payerSummary.fromType,
          transactionCount: Number(payerSummary.txCount),
          lastActivityAt: payerSummary.lastActivityAt.toISOString(),
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/customers");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/team/members", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_MEMBERS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const data = await listBusinessMembers(businessId);
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/team/members");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/team/invites", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_MEMBERS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const data = await listPendingInvites(businessId);
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/team/invites");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/team/invites", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_MEMBERS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = inviteBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Invalid body.", details: parsed.error.flatten() });
      }
      const userId = req.businessPortalTenant?.userId ?? null;
      const ok = await canManageTeamMembers(businessId, userId, viaApiKey(req));
      if (!ok) {
        return reply.status(403).send({ success: false, error: "Only owners and admins can invite.", code: "FORBIDDEN" });
      }
      try {
        const result = await createBusinessMemberInvite({
          businessId,
          email: parsed.data.email,
          role: parsed.data.role as BusinessRole,
          invitedByUserId: userId,
        });
        return successEnvelope(reply, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invite failed.";
        return reply.status(400).send({ success: false, error: msg });
      }
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/team/invites");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.delete("/team/invites/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_MEMBERS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const userId = req.businessPortalTenant?.userId ?? null;
      const ok = await canManageTeamMembers(businessId, userId, viaApiKey(req));
      if (!ok) {
        return reply.status(403).send({ success: false, error: "Forbidden.", code: "FORBIDDEN" });
      }
      const revoked = await revokeBusinessMemberInvite(businessId, req.params.id);
      if (!revoked) return errorEnvelope(reply, "Invite not found.", 404);
      return successEnvelope(reply, { revoked: true });
    } catch (err) {
      req.log.error({ err }, "DELETE /api/v1/merchant/team/invites/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/team/members/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_MEMBERS_WRITE, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = patchMemberBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Invalid body.", details: parsed.error.flatten() });
      }
      try {
        await updateMemberRole(
          businessId,
          req.params.id,
          parsed.data.role as BusinessRole,
          req.businessPortalTenant?.userId ?? null,
          viaApiKey(req)
        );
        return successEnvelope(reply, { ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Update failed.";
        return reply.status(400).send({ success: false, error: msg });
      }
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/team/members/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/payout-methods", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const rows = await prisma.payoutMethod.findMany({
        where: { businessId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });
      const data = rows.map((payoutMethod) => ({
        id: payoutMethod.id,
        type: payoutMethod.type,
        currency: payoutMethod.currency,
        isPrimary: payoutMethod.isPrimary,
        isActive: payoutMethod.isActive,
        createdAt: payoutMethod.createdAt.toISOString(),
        details: { configured: true },
      }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/payout-methods");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/payout-methods", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_FINANCE)) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = payoutMethodBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Invalid body.", details: parsed.error.flatten() });
      }
      if (parsed.data.isPrimary) {
        await prisma.payoutMethod.updateMany({
          where: { businessId },
          data: { isPrimary: false },
        });
      }
      const created = await prisma.payoutMethod.create({
        data: {
          businessId,
          type: parsed.data.type as PayoutMethodType,
          currency: parsed.data.currency,
          details: parsed.data.details as object,
          isPrimary: parsed.data.isPrimary ?? false,
        },
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: created.id,
          type: created.type,
          currency: created.currency,
          isPrimary: created.isPrimary,
          isActive: created.isActive,
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/payout-methods");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/payout-methods/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_FINANCE)) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = patchPayoutMethodBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "Invalid body.", details: parsed.error.flatten() });
      }
      const existing = await prisma.payoutMethod.findFirst({
        where: { id: req.params.id, businessId },
      });
      if (!existing) return errorEnvelope(reply, "Not found.", 404);
      if (parsed.data.isPrimary) {
        await prisma.payoutMethod.updateMany({
          where: { businessId, id: { not: req.params.id } },
          data: { isPrimary: false },
        });
      }
      const updated = await prisma.payoutMethod.update({
        where: { id: req.params.id },
        data: {
          isPrimary: parsed.data.isPrimary ?? undefined,
          isActive: parsed.data.isActive ?? undefined,
          details: parsed.data.details != null ? (parsed.data.details as object) : undefined,
        },
      });
      return successEnvelope(reply, {
        id: updated.id,
        type: updated.type,
        currency: updated.currency,
        isPrimary: updated.isPrimary,
        isActive: updated.isActive,
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/payout-methods/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/logs",
    async (req: FastifyRequest<{ Querystring: { limit?: string; offset?: string; path?: string; method?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "50", 10) || 50));
        const offset = Math.max(0, parseInt(req.query.offset ?? "0", 10) || 0);
        const { entries, total } = getRequestLogs({
          tenantBusinessId: businessId,
          path: req.query.path,
          method: req.query.method,
          limit,
          offset,
        });
        return reply.status(200).send({
          success: true,
          data: entries,
          meta: { limit, offset, total },
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/logs");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.patch("/api-keys/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN_DEV)) return;
      const businessId = getMerchantV1BusinessId(req);
      const body = z.object({ action: z.enum(["deactivate"]) }).safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ success: false, error: "Body must be { \"action\": \"deactivate\" }." });
      }
      if (body.data.action === "deactivate") {
        const ok = await deactivateApiKeyForBusiness(req.params.id, businessId);
        if (!ok) return errorEnvelope(reply, "API key not found.", 404);
        return successEnvelope(reply, { deactivated: true });
      }
      return errorEnvelope(reply, "Unsupported action.", 400);
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/api-keys/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
