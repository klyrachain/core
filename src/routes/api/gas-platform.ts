import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { GasLedgerReason } from "../../../prisma/generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope, parsePagination, successEnvelopeWithMeta } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ, PERMISSION_SETTINGS_WRITE } from "../../lib/permissions.js";
import { recordGasCredit } from "../../services/gas-ledger.service.js";

const PLATFORM_ID = "default";

const PatchPlatformGasSchema = z.object({
  sponsorshipEnabled: z.boolean().optional(),
  maxUsdPerTx: z.coerce.number().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const CreditBusinessGasSchema = z.object({
  businessId: z.string().uuid(),
  amountUsd: z.coerce.number().positive(),
  idempotencyKey: z.string().min(8).max(200),
  reason: z.enum(["TOPUP", "ADJUSTMENT", "REFUND"]).optional().default("TOPUP"),
});

const GAS_LEDGER_REASONS: readonly GasLedgerReason[] = [
  "TOPUP",
  "SPONSORSHIP",
  "ADJUSTMENT",
  "REFUND",
];

export async function gasPlatformApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/platform/gas/settings", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const row =
        (await prisma.platformGasSettings.findUnique({ where: { id: PLATFORM_ID } })) ??
        (await prisma.platformGasSettings.create({
          data: { id: PLATFORM_ID },
        }));
      return successEnvelope(reply, {
        sponsorshipEnabled: row.sponsorshipEnabled,
        maxUsdPerTx: row.maxUsdPerTx != null ? row.maxUsdPerTx.toString() : null,
        notes: row.notes ?? null,
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/platform/gas/settings");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.patch("/api/platform/gas/settings", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const parsed = PatchPlatformGasSchema.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, "Invalid body.", 400);
      }
      const b = parsed.data;
      const row = await prisma.platformGasSettings.upsert({
        where: { id: PLATFORM_ID },
        create: {
          id: PLATFORM_ID,
          sponsorshipEnabled: b.sponsorshipEnabled ?? false,
          maxUsdPerTx: b.maxUsdPerTx ?? undefined,
          notes: b.notes ?? undefined,
        },
        update: {
          ...(b.sponsorshipEnabled !== undefined ? { sponsorshipEnabled: b.sponsorshipEnabled } : {}),
          ...(b.maxUsdPerTx !== undefined ? { maxUsdPerTx: b.maxUsdPerTx } : {}),
          ...(b.notes !== undefined ? { notes: b.notes } : {}),
        },
      });
      return successEnvelope(reply, {
        sponsorshipEnabled: row.sponsorshipEnabled,
        maxUsdPerTx: row.maxUsdPerTx != null ? row.maxUsdPerTx.toString() : null,
        notes: row.notes ?? null,
      });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/platform/gas/settings");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/api/platform/gas/businesses",
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
        const { page, limit, skip } = parsePagination(req.query ?? {});
        const [total, rows] = await prisma.$transaction([
          prisma.businessGasAccount.count(),
          prisma.businessGasAccount.findMany({
            orderBy: { updatedAt: "desc" },
            skip,
            take: limit,
            include: {
              business: { select: { id: true, name: true, slug: true } },
            },
          }),
        ]);
        const data = rows.map((gasBalanceRow) => ({
          businessId: gasBalanceRow.businessId,
          businessName: gasBalanceRow.business.name,
          slug: gasBalanceRow.business.slug,
          prepaidBalanceUsd: gasBalanceRow.prepaidBalanceUsd.toString(),
          sponsorshipEnabled: gasBalanceRow.sponsorshipEnabled,
          lowBalanceWarnUsd:
            gasBalanceRow.lowBalanceWarnUsd != null
              ? gasBalanceRow.lowBalanceWarnUsd.toString()
              : null,
          updatedAt: gasBalanceRow.updatedAt.toISOString(),
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/platform/gas/businesses");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** Paginated gas ledger. Optional `reason` (e.g. SPONSORSHIP for sponsored tx debits). */
  app.get(
    "/api/platform/gas/ledger",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; reason?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
        const { page, limit, skip } = parsePagination(req.query ?? {});
        const raw = req.query.reason?.trim();
        const reason =
          raw && (GAS_LEDGER_REASONS as readonly string[]).includes(raw)
            ? (raw as GasLedgerReason)
            : undefined;
        const where = reason ? { reason } : {};
        const [total, rows] = await prisma.$transaction([
          prisma.gasLedgerEntry.count({ where }),
          prisma.gasLedgerEntry.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
              business: { select: { id: true, name: true, slug: true } },
            },
          }),
        ]);
        const data = rows.map((ledgerRow) => ({
          id: ledgerRow.id,
          createdAt: ledgerRow.createdAt.toISOString(),
          businessId: ledgerRow.businessId,
          businessName: ledgerRow.business?.name ?? null,
          slug: ledgerRow.business?.slug ?? null,
          direction: ledgerRow.direction,
          amountUsd: ledgerRow.amountUsd.toString(),
          reason: ledgerRow.reason,
          idempotencyKey: ledgerRow.idempotencyKey,
          metadata: ledgerRow.metadata,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/platform/gas/ledger");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** Credit a business gas balance (admin / super admin). */
  app.post("/api/platform/gas/credit", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_SETTINGS_WRITE)) return;
      const parsed = CreditBusinessGasSchema.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, "Invalid body.", 400);
      }
      const b = parsed.data;
      const biz = await prisma.business.findUnique({ where: { id: b.businessId }, select: { id: true } });
      if (!biz) {
        return errorEnvelope(reply, "Business not found.", 404);
      }
      const idem = `platform-credit:${b.idempotencyKey}`;
      const result = await recordGasCredit({
        businessId: b.businessId,
        amountUsd: b.amountUsd,
        idempotencyKey: idem,
        reason: b.reason,
        metadata: { source: "platform_admin" },
      });
      if (!result.ok) {
        return errorEnvelope(reply, result.error, 400);
      }
      const acc = await prisma.businessGasAccount.findUnique({
        where: { businessId: b.businessId },
      });
      return successEnvelope(reply, {
        entryId: result.entryId,
        prepaidBalanceUsd: acc?.prepaidBalanceUsd.toString() ?? "0",
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/platform/gas/credit");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
