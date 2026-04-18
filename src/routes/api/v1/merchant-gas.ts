import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { successEnvelope, errorEnvelope, parsePagination, successEnvelopeWithMeta } from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import { PERMISSION_BUSINESS_READ, PERMISSION_BUSINESS_WRITE } from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { requireMerchantRole, OWNER_ADMIN } from "../../../lib/merchant-rbac.js";
import { getClearingBalanceUsd, transferClearingToGasPrepaid } from "../../../services/clearing-balance.service.js";
import { createGasFundingPaymentLink } from "../../../services/gas-funding-payment-link.service.js";
import { getMerchantEnvironmentOrThrow } from "../../../lib/merchant-environment.js";
import { getEnv } from "../../../config/env.js";
import { startGasTopupPaystackForMerchant } from "../../../services/gas-paystack-merchant-init.service.js";

const PatchMerchantGasSchema = z.object({
  sponsorshipEnabled: z.boolean().optional(),
  lowBalanceWarnUsd: z.coerce.number().nonnegative().nullable().optional(),
});

const TopupFromClearingSchema = z.object({
  amountUsd: z.coerce.number().positive(),
  idempotencyKey: z.string().min(8).max(200),
});

const TopupPrepareSchema = z.object({
  amountUsd: z.coerce.number().positive(),
  purpose: z.enum(["GAS_TOPUP_FIAT", "GAS_TOPUP_CRYPTO"]),
});

const PaystackGasInitSchema = z.object({
  paymentLinkId: z.string().uuid(),
  payer_email: z.string().email().optional(),
  payer_wallet: z
    .string()
    .trim()
    .optional()
    .refine((s) => !s || /^0x[a-fA-F0-9]{40}$/.test(s), "Invalid wallet"),
  callback_url: z.string().url().optional(),
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
        const clearingBalanceUsd = await getClearingBalanceUsd(businessId);
        return successEnvelope(reply, {
          businessId,
          prepaidBalanceUsd: "0",
          clearingBalanceUsd,
          sponsorshipEnabled: false,
          lowBalanceWarnUsd: null,
          hasAccount: false,
        });
      }
      const clearingBalanceUsd = await getClearingBalanceUsd(businessId);
      return successEnvelope(reply, {
        businessId,
        hasAccount: true,
        prepaidBalanceUsd: acc.prepaidBalanceUsd.toString(),
        clearingBalanceUsd,
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

      const clearingBalanceUsd = await getClearingBalanceUsd(businessId);
      return successEnvelope(reply, {
        prepaidBalanceUsd: acc.prepaidBalanceUsd.toString(),
        clearingBalanceUsd,
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
        const data = rows.map((ledgerRow) => ({
          id: ledgerRow.id,
          createdAt: ledgerRow.createdAt.toISOString(),
          direction: ledgerRow.direction,
          amountUsd: ledgerRow.amountUsd.toString(),
          reason: ledgerRow.reason,
          metadata: ledgerRow.metadata,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/v1/merchant/gas/ledger");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/gas/clearing", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const clearingBalanceUsd = await getClearingBalanceUsd(businessId);
      return successEnvelope(reply, { clearingBalanceUsd });
    } catch (err) {
      req.log.error({ err }, "GET /api/v1/merchant/gas/clearing");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/gas/topup/from-clearing", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN)) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = TopupFromClearingSchema.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, "Invalid body.", 400);
      }
      const r = await transferClearingToGasPrepaid({
        businessId,
        amountUsd: parsed.data.amountUsd,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      if (!r.ok) {
        return errorEnvelope(reply, r.error, 400);
      }
      const [prepaid, clearing] = await Promise.all([
        prisma.businessGasAccount.findUnique({
          where: { businessId },
          select: { prepaidBalanceUsd: true },
        }),
        getClearingBalanceUsd(businessId),
      ]);
      return successEnvelope(reply, {
        prepaidBalanceUsd: prepaid?.prepaidBalanceUsd.toString() ?? "0",
        clearingBalanceUsd: clearing,
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/gas/topup/from-clearing");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.post("/gas/topup/prepare", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN)) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = TopupPrepareSchema.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, "Invalid body.", 400);
      }
      const environment = getMerchantEnvironmentOrThrow(req);
      const link = await createGasFundingPaymentLink({
        businessId,
        environment,
        amountUsd: parsed.data.amountUsd,
        purpose: parsed.data.purpose,
      });
      const env = getEnv();
      const base =
        env.CHECKOUT_BASE_URL?.replace(/\/$/, "") ??
        env.FRONTEND_APP_URL.replace(/\/$/, "");
      const checkoutPath = `/checkout/business/${encodeURIComponent(link.publicCode)}`;
      const checkoutAbsoluteUrl = `${base}${checkoutPath}`;
      return successEnvelope(
        reply,
        {
          paymentLinkId: link.id,
          publicCode: link.publicCode,
          checkoutPath,
          checkoutAbsoluteUrl,
        },
        201
      );
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/gas/topup/prepare");
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      return errorEnvelope(reply, msg, 500);
    }
  });

  app.post("/gas/topup/paystack/initialize", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_WRITE, { allowMerchant: true })) return;
      if (!requireMerchantRole(req, reply, OWNER_ADMIN)) return;
      const businessId = getMerchantV1BusinessId(req);
      const parsed = PaystackGasInitSchema.safeParse(req.body);
      if (!parsed.success) {
        return errorEnvelope(reply, "Invalid body.", 400);
      }
      const r = await startGasTopupPaystackForMerchant({
        businessId,
        paymentLinkId: parsed.data.paymentLinkId,
        payerEmail: parsed.data.payer_email,
        payerWallet: parsed.data.payer_wallet,
        callbackUrl: parsed.data.callback_url,
      });
      if (!r.ok) {
        return reply.status(r.status ?? 400).send({
          success: false,
          error: r.error,
          code: r.code,
        });
      }
      return successEnvelope(
        reply,
        {
          authorization_url: r.authorization_url,
          access_code: r.access_code,
          reference: r.reference,
          transaction_id: r.transaction_id,
        },
        201
      );
    } catch (err) {
      req.log.error({ err }, "POST /api/v1/merchant/gas/topup/paystack/initialize");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
