import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { successEnvelope, errorEnvelope, parsePagination, successEnvelopeWithMeta } from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import { PERMISSION_BUSINESS_READ, PERMISSION_BUSINESS_WRITE } from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { requireMerchantRole, OWNER_ADMIN } from "../../../lib/merchant-rbac.js";

const PatchMerchantGasSchema = z.object({
  sponsorshipEnabled: z.boolean().optional(),
  lowBalanceWarnUsd: z.coerce.number().nonnegative().nullable().optional(),
});

export function registerMerchantGasRoutes(app: FastifyInstance): void {
  app.get("/gas/account", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const acc = await prisma.businessGasAccount.findUnique({
        where: { businessId },
        include: {
          business: { select: { name: true, slug: true } },
        },
      });
      if (!acc) {
        return successEnvelope(reply, {
          businessId,
          prepaidBalanceUsd: "0",
          sponsorshipEnabled: false,
          lowBalanceWarnUsd: null,
          hasAccount: false,
        });
      }
      return successEnvelope(reply, {
        businessId,
        hasAccount: true,
        prepaidBalanceUsd: acc.prepaidBalanceUsd.toString(),
        sponsorshipEnabled: acc.sponsorshipEnabled,
        lowBalanceWarnUsd: acc.lowBalanceWarnUsd != null ? acc.lowBalanceWarnUsd.toString() : null,
        businessName: acc.business.name,
        slug: acc.business.slug,
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/gas/account");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/gas/account", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN)) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = PatchMerchantGasSchema.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, "Invalid body.", 400);
      }
      const b = parsed.data;
      const balanceRow = await prisma.businessGasAccount.findUnique({
        where: { businessId },
        select: { prepaidBalanceUsd: true },
      });
      const balance = balanceRow != null ? Number(balanceRow.prepaidBalanceUsd.toString()) : 0;

      if (b.sponsorshipEnabled === true && balance <= 0) {
        return errorEnvelope(
          reply,
          "Fund your gas account before enabling sponsorship.",
          400
        );
      }

      const acc = await prisma.businessGasAccount.upsert({
        where: { businessId },
        create: {
          businessId,
          sponsorshipEnabled: b.sponsorshipEnabled ?? false,
          lowBalanceWarnUsd: b.lowBalanceWarnUsd ?? undefined,
        },
        update: {
          ...(b.sponsorshipEnabled !== undefined ? { sponsorshipEnabled: b.sponsorshipEnabled } : {}),
          ...(b.lowBalanceWarnUsd !== undefined ? { lowBalanceWarnUsd: b.lowBalanceWarnUsd } : {}),
        },
      });

      return successEnvelope(reply, {
        prepaidBalanceUsd: acc.prepaidBalanceUsd.toString(),
        sponsorshipEnabled: acc.sponsorshipEnabled,
        lowBalanceWarnUsd: acc.lowBalanceWarnUsd != null ? acc.lowBalanceWarnUsd.toString() : null,
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/v1/merchant/gas/account");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/gas/ledger",
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);
        const { page, limit, skip } = parsePagination(req.query ?? {});
        const [total, rows] = await prisma.$transaction([
          prisma.gasLedgerEntry.count({ where: { businessId } }),
          prisma.gasLedgerEntry.findMany({
            where: { businessId },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
        ]);
        const data = rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          direction: r.direction,
          amountUsd: r.amountUsd.toString(),
          reason: r.reason,
          metadata: r.metadata,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/gas/ledger");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
