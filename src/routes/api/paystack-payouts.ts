/**
 * Paystack payouts (offramp): request payout link after confirming crypto tx, then execute transfer.
 * Test vs live: Paystack uses the same API; test/live is determined by PAYSTACK_SECRET_KEY (sk_test_* vs sk_live_*).
 * No separate test payout endpoint — use test key for sandbox, live key when you fund live balance.
 * Note: Paystack Transfer API is used (create recipient + initiate transfer). Availability/limits depend on
 * region, currency, and account balance; logic here is correct but provider may not support all payout types.
 */

import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  createTransferRecipient,
  initiateTransfer,
  isPaystackConfigured,
  verifyTransfer,
} from "../../services/paystack.service.js";
import { createPaystackTransferRecord } from "../../services/paystack-transfer-record.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PAYOUTS_READ, PERMISSION_PAYOUTS_WRITE } from "../../lib/permissions.js";

function generatePayoutCode(): string {
  return randomBytes(12).toString("base64url");
}

const RequestBodySchema = z.object({
  transaction_id: z.string().uuid(),
  transaction_hash: z.string().optional(), // optional extra verification; we don't store it yet
});

const ExecuteBodySchema = z.object({
  code: z.string().min(1),
  amount: z.coerce.number().positive(), // in subunits (kobo/pesewas)
  currency: z.string().min(1),
  recipient_type: z.enum(["nuban", "mobile_money"]),
  name: z.string().min(1),
  account_number: z.string().min(1),
  bank_code: z.string().optional(), // required for nuban; for mobile_money this is provider code (e.g. MTN)
  reason: z.string().optional(),
});

const HistoryQuerySchema = z.object({
  perPage: z.coerce.number().min(1).max(100).optional(),
  page: z.coerce.number().min(1).optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
});

const payoutHistoryInclude = {
  transaction: {
    select: {
      id: true,
      type: true,
      status: true,
      f_amount: true,
      t_amount: true,
      f_token: true,
      t_token: true,
    },
  },
} as const;

type PayoutRequestWithTransaction = Awaited<
  ReturnType<
    typeof prisma.payoutRequest.findMany<
      { include: typeof payoutHistoryInclude }
    >
  >
>[number];

export async function paystackPayoutsApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/api/paystack/payouts/request",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_WRITE, { allowMerchant: true })) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = RequestBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { transaction_id } = parse.data;

      const tx = await prisma.transaction.findUnique({
        where: { id: transaction_id },
      });
      if (!tx) {
        return reply.status(404).send({ success: false, error: "Transaction not found." });
      }
      if (tx.status !== "COMPLETED") {
        return reply.status(400).send({
          success: false,
          error: "Transaction must be COMPLETED before requesting payout.",
        });
      }

      const code = generatePayoutCode();
      const existing = await prisma.payoutRequest.findFirst({
        where: { code },
      });
      if (existing) {
        return errorEnvelope(reply, "Code collision; retry.", 500);
      }

      const payout = await prisma.payoutRequest.create({
        data: {
          code,
          transactionId: transaction_id,
          status: "pending",
        },
      });

      return successEnvelope(
        reply,
        {
          code: payout.code,
          payout_request_id: payout.id,
          transaction_id: transaction_id,
          message: "Use this code with POST /api/paystack/payouts/execute to complete payout.",
        },
        201
      );
    }
  );

  /** Verify payout (transfer) by reference. Use the reference returned from execute. */
  app.get<{ Params: { reference: string } }>(
    "/api/paystack/payouts/verify/:reference",
    async (req: FastifyRequest<{ Params: { reference: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const reference = req.params.reference?.trim();
      if (!reference) {
        return reply.status(400).send({ success: false, error: "reference is required." });
      }
      try {
        const data = await verifyTransfer(reference);
        return successEnvelope(reply, {
          ...data,
          success: data.status === "success",
        });
      } catch (err) {
        req.log.error({ err, reference }, "GET /api/paystack/payouts/verify/:reference");
        const msg = err instanceof Error ? err.message : "Verification failed.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );

  app.get(
    "/api/paystack/payouts/:code",
    async (req: FastifyRequest<{ Params: { code: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
      const { code } = req.params;
      const payout = await prisma.payoutRequest.findUnique({
        where: { code },
        include: {
          transaction: {
            select: {
              id: true,
              type: true,
              status: true,
              f_amount: true,
              t_amount: true,
              f_token: true,
              t_token: true,
              fromIdentifier: true,
              toIdentifier: true,
            },
          },
        },
      });
      if (!payout) {
        return reply.status(404).send({ success: false, error: "Payout request not found." });
      }
      const data = {
        code: payout.code,
        payout_request_id: payout.id,
        status: payout.status,
        amount: payout.amount?.toString() ?? null,
        currency: payout.currency,
        transfer_code: payout.transferCode ?? null,
        transfer_reference: payout.transferReference ?? null,
        recipient: payout.recipientName || payout.recipientType
          ? { name: payout.recipientName ?? null, type: payout.recipientType ?? null }
          : null,
        transaction_id: payout.transactionId,
        transaction: payout.transaction
          ? {
            ...payout.transaction,
            f_amount: payout.transaction.f_amount.toString(),
            t_amount: payout.transaction.t_amount.toString(),
          }
          : null,
      };
      return successEnvelope(reply, data);
    }
  );

  /** List payout requests from DB (dashboard). Paginated; optional status filter. */
  app.get(
    "/api/paystack/payouts/history",
    async (
      req: FastifyRequest<{
        Querystring: { perPage?: string; page?: string; status?: string };
      }>,
      reply
    ) => {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_READ, { allowMerchant: true })) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = HistoryQuerySchema.safeParse({
        perPage: req.query.perPage,
        page: req.query.page,
        status: req.query.status,
      });
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { perPage = 20, page = 1, status } = parse.data;
      const skip = (page - 1) * perPage;
      const where = status ? { status } : {};
      const [items, total] = await Promise.all([
        prisma.payoutRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: perPage,
          include: payoutHistoryInclude,
        }),
        prisma.payoutRequest.count({ where }),
      ]);
      const data = items.map((p: PayoutRequestWithTransaction) => ({
        id: p.id,
        code: p.code,
        status: p.status,
        amount: p.amount?.toString() ?? null,
        currency: p.currency,
        recipient_name: p.recipientName,
        recipient_type: p.recipientType,
        transfer_code: p.transferCode,
        transfer_reference: p.transferReference,
        transaction_id: p.transactionId,
        transaction: p.transaction
          ? {
            ...p.transaction,
            f_amount: p.transaction.f_amount.toString(),
            t_amount: p.transaction.t_amount.toString(),
          }
          : null,
        created_at: p.createdAt.toISOString(),
      }));
      return successEnvelope(reply, {
        payouts: data,
        meta: { total, perPage, page, pageCount: Math.ceil(total / perPage) },
      });
    }
  );

  app.post<{ Body: unknown }>(
    "/api/paystack/payouts/execute",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_PAYOUTS_WRITE, { allowMerchant: true })) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = ExecuteBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { code, amount, currency, recipient_type, name, account_number, bank_code, reason } = parse.data;

      if (recipient_type === "nuban" && !bank_code) {
        return reply.status(400).send({
          success: false,
          error: "bank_code is required for recipient_type nuban.",
        });
      }
      if (recipient_type === "mobile_money" && !bank_code) {
        return reply.status(400).send({
          success: false,
          error: "bank_code (provider code, e.g. MTN) is required for recipient_type mobile_money.",
        });
      }

      const payout = await prisma.payoutRequest.findUnique({
        where: { code },
        include: { transaction: true },
      });
      if (!payout) {
        return reply.status(404).send({ success: false, error: "Payout request not found." });
      }
      if (payout.status !== "pending") {
        return reply.status(400).send({
          success: false,
          error: `Payout request is already ${payout.status}.`,
        });
      }

      const type = recipient_type === "nuban" ? "nuban" : "mobile_money";
      // Ghana (GHS) mobile money: Paystack expects local format (0XXXXXXXXX). Strip country code 233 if present.
      let accountForPaystack = account_number.trim();
      if (currency === "GHS" && type === "mobile_money" && accountForPaystack.startsWith("233")) {
        const local = accountForPaystack.slice(3).replace(/^0+/, "") || "0";
        accountForPaystack = local.length === 9 ? `0${local}` : local.startsWith("0") ? local : `0${local}`;
      }
      try {
        const { recipient_code } = await createTransferRecipient({
          type,
          name,
          account_number: accountForPaystack,
          bank_code: bank_code ?? undefined,
          currency,
        });

        const reference = `payout_${payout.id}_${Date.now()}`.slice(0, 50);
        const result = await initiateTransfer({
          source: "balance",
          amount,
          recipient: recipient_code,
          reference,
          reason: reason ?? "Payout",
          currency,
        });

        await prisma.payoutRequest.update({
          where: { id: payout.id },
          data: {
            status: result.status === "success" ? "completed" : "pending",
            amount,
            currency,
            recipientCode: recipient_code,
            recipientName: name,
            recipientType: recipient_type,
            transferCode: result.transfer_code,
            transferReference: result.reference,
          },
        });

        await createPaystackTransferRecord({
          reference: result.reference,
          transfer_code: result.transfer_code,
          amount,
          currency,
          status: result.status,
          payout_request_id: payout.id,
          recipient_name: name,
          reason: reason ?? "Payout",
          raw_response: {
            reference: result.reference,
            transfer_code: result.transfer_code,
            amount,
            currency,
            status: result.status,
            reason: reason ?? "Payout",
            id: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }).catch((err) => req.log.warn({ err }, "Create transfer record failed"));

        const success = result.status === "success";
        return successEnvelope(reply, {
          success: success,
          status: result.status,
          transfer_code: result.transfer_code,
          reference: result.reference,
          payout_request_id: payout.id,
          recipient: { name, type: recipient_type },
          message: success
            ? "Transfer completed. Use GET /api/paystack/payouts/verify/:reference to confirm."
            : "Transfer queued; use GET /api/paystack/payouts/verify/:reference to check status or wait for webhook.",
        });
      } catch (err) {
        const paystackResponse =
          err && typeof err === "object" && "paystackResponse" in err
            ? (err as { paystackResponse: unknown }).paystackResponse
            : undefined;
        req.log.error(
          { err, code, paystackResponse, body: { recipient_type, account_number: `${account_number?.slice(0, 4)}***`, currency, bank_code } },
          "Paystack payout execute"
        );
        await prisma.payoutRequest.update({
          where: { id: payout.id },
          data: { status: "failed" },
        }).catch(() => { });
        const msg = err instanceof Error ? err.message : "Payout execution failed.";
        const payload: { success: false; error: string; paystackResponse?: unknown } = { success: false, error: msg };
        if (paystackResponse !== undefined) payload.paystackResponse = paystackResponse;
        return reply.status(502).send(payload);
      }
    }
  );
}
