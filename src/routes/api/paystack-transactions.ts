/**
 * Paystack transactions: verify by reference, fetch by ID, list (admin).
 * All require x-api-key; backend uses PAYSTACK_SECRET_KEY to call Paystack.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  verifyTransaction,
  getTransactionById,
  listTransactions,
  isPaystackConfigured,
  sanitizeTransactionData,
} from "../../services/paystack.service.js";
import { upsertPaystackPaymentRecord } from "../../services/paystack-payment-record.service.js";
import { computeTransactionFee } from "../../services/fee.service.js";
import { executeOnrampSend } from "../../services/onramp-execution.service.js";
import { onRequestPaymentSettled } from "../../services/request-settlement.service.js";
import { settleCommercePaystackTransaction } from "../../services/commerce-paystack-settlement.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import { notifyPeerRampFiatPaymentReceived } from "../../services/peer-ramp-notify.service.js";

const ListQuerySchema = z.object({
  perPage: z.coerce.number().min(1).max(100).optional(),
  page: z.coerce.number().min(1).optional(),
  status: z.enum(["failed", "success", "abandoned"]).optional(),
  customer: z.coerce.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  amount: z.coerce.number().optional(),
});

export async function paystackTransactionsApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Verify a transaction by reference (e.g. after user returns from Paystack checkout).
   * Returns full Paystack verification payload so frontend can show "payment successful" and details.
   */
  app.get<{ Params: { reference: string } }>(
    "/api/paystack/transactions/verify/:reference",
    async (req: FastifyRequest<{ Params: { reference: string } }>, reply) => {
      if (
        !requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, {
          allowMerchant: true,
        })
      )
        return;
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
      if (!/^[A-Za-z0-9_.=-]+$/.test(reference)) {
        return reply.status(400).send({
          success: false,
          error: "Invalid reference format.",
        });
      }
      try {
        const data = await verifyTransaction(reference);
        const ourTransactionId = (data.metadata?.transaction_id as string) ?? null;
        await upsertPaystackPaymentRecord(data, ourTransactionId);

        // When webhook is not reachable (e.g. no ngrok): if verify shows success and we have a BUY order still PENDING, treat as payment confirmed and trigger crypto send.
        const paymentSuccess = String(data.status).toLowerCase() === "success";
        const payerEmailFromVerify =
          typeof data.metadata?.payer_email === "string"
            ? data.metadata.payer_email.trim()
            : null;
        if (paymentSuccess && ourTransactionId) {
          await settleCommercePaystackTransaction({
            transactionId: ourTransactionId,
            reference,
            payerEmail: payerEmailFromVerify,
          });

          const tx = await prisma.transaction.findUnique({
            where: { id: ourTransactionId },
          });

          if (
            tx?.type === "BUY" &&
            !tx.paymentLinkId &&
            tx.status === "PENDING" &&
            tx.paymentConfirmedAt == null
          ) {
            req.log.info(
              { transactionId: ourTransactionId, reference },
              "[onramp] Verify: payment confirmed (webhook not used). Triggering crypto send."
            );
            console.log(
              `[onramp] Step 1 (via verify): Paystack payment CONFIRMED for transaction ${ourTransactionId} (reference ${reference}). Webhook was not used. Proceeding to Step 2: send crypto.`
            );
            const feeAmount = computeTransactionFee(tx);
            const updateResult = await prisma.transaction.updateMany({
              where: {
                id: ourTransactionId,
                status: "PENDING",
                paymentConfirmedAt: null,
              },
              data: {
                paymentConfirmedAt: new Date(),
                ...(Number.isFinite(feeAmount) ? { fee: feeAmount, platformFee: feeAmount } : {}),
              },
            });
            if (updateResult.count > 0) {
              void notifyPeerRampFiatPaymentReceived(ourTransactionId, reference).catch((e) =>
                req.log.warn({ err: e, transactionId: ourTransactionId }, "peer-ramp fiat notify")
              );
              setImmediate(() => {
                executeOnrampSend(ourTransactionId).then((r) => {
                  if (!r.ok) {
                    req.log.warn(
                      { err: r.error, code: r.code, transactionId: ourTransactionId },
                      "[onramp] Step 2 FAILED (verify path): crypto send failed."
                    );
                    console.warn(
                      `[onramp] Step 2 FAILED: crypto send failed for ${ourTransactionId}. Error: ${r.error} (code: ${r.code ?? "—"}).`
                    );
                  }
                }).catch((err) => {
                  req.log.error({ err, transactionId: ourTransactionId }, "[onramp] Step 2 error (verify path)");
                  console.error(`[onramp] Step 2 error for ${ourTransactionId}:`, err);
                });
              });
            }
          }
          // When webhook is not reachable: REQUEST — set COMPLETED and trigger claim notification.
          if (
            tx?.type === "REQUEST" &&
            tx.status === "PENDING"
          ) {
            req.log.info(
              { transactionId: ourTransactionId, reference },
              "[request] Verify: payment confirmed (webhook not used). Marking COMPLETED and sending claim notification."
            );
            const feeAmount = computeTransactionFee(tx);
            const updateResult = await prisma.transaction.updateMany({
              where: { id: ourTransactionId, status: "PENDING" },
              data: {
                status: "COMPLETED",
                paymentConfirmedAt: new Date(),
                ...(Number.isFinite(feeAmount) ? { fee: feeAmount, platformFee: feeAmount } : {}),
              },
            });
            if (updateResult.count > 0) {
              setImmediate(() => {
                onRequestPaymentSettled({ transactionId: ourTransactionId }).then((r) => {
                  if (!r.ok) {
                    req.log.warn(
                      { err: r.error, transactionId: ourTransactionId },
                      "[request] Verify path: settlement failed."
                    );
                  }
                }).catch((err) => {
                  req.log.error({ err, transactionId: ourTransactionId }, "[request] Verify path: settlement error");
                });
              });
            }
          }
        }
        const txForStatus = ourTransactionId
          ? await prisma.transaction.findUnique({
              where: { id: ourTransactionId },
              select: { id: true, status: true, paymentConfirmedAt: true, cryptoSendTxHash: true },
            })
          : null;

        let confirmation: {
          transactionId: string;
          paymentReference: string;
          businessName: string | null;
          paymentLinkPublicCode: string | null;
          invoiceAmount: string | null;
          invoiceCurrency: string | null;
          paidAmountMajor: string;
          paidCurrency: string;
          chargeKind: string | null;
          /** FIAT = local currency checkout; CRYPTO = crypto-denominated payment link. */
          paymentRail: "fiat" | "crypto";
          /** Paystack channel when available (e.g. card, mobile_money). Omitted from UI labels in the app. */
          channel: string | null;
          /** Set when paymentRail is crypto: destination token symbol from the order. */
          cryptoToken: string | null;
          /** Set when paymentRail is crypto: destination chain code from the order (e.g. BASE, POLYGON). */
          cryptoChain: string | null;
        } | null = null;
        if (ourTransactionId) {
          const full = await prisma.transaction.findUnique({
            where: { id: ourTransactionId },
            include: {
              business: { select: { name: true } },
              paymentLink: {
                select: {
                  publicCode: true,
                  amount: true,
                  currency: true,
                  chargeKind: true,
                },
              },
            },
          });
          if (full) {
            const paidN = Number(data.amount);
            const paidMajor = Number.isFinite(paidN) ? paidN / 100 : 0;
            const chargeKind =
              full.paymentLink?.chargeKind != null ? String(full.paymentLink.chargeKind) : null;
            const paymentRail = chargeKind === "CRYPTO" ? "crypto" : "fiat";
            confirmation = {
              transactionId: full.id,
              paymentReference: (data.reference ?? reference).trim(),
              businessName: full.business?.name?.trim() ?? null,
              paymentLinkPublicCode: full.paymentLink?.publicCode?.trim() ?? null,
              invoiceAmount:
                full.paymentLink?.amount != null ? full.paymentLink.amount.toString() : null,
              invoiceCurrency: full.paymentLink?.currency?.trim() ?? null,
              paidAmountMajor: paidMajor.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              }),
              paidCurrency: (data.currency ?? "").trim().toUpperCase(),
              chargeKind,
              paymentRail,
              channel: data.channel?.trim() ?? null,
              cryptoToken:
                paymentRail === "crypto" ? (full.t_token?.trim() ?? null) : null,
              cryptoChain:
                paymentRail === "crypto" ? (full.t_chain?.trim() ?? null) : null,
            };
          }
        }

        return successEnvelope(reply, {
          ...sanitizeTransactionData(data),
          settlement: txForStatus
            ? {
                transactionId: txForStatus.id,
                paymentVerified: true,
                paymentConfirmedAt: txForStatus.paymentConfirmedAt?.toISOString() ?? null,
                settlementStatus: txForStatus.status,
                cryptoSendTxHash: txForStatus.cryptoSendTxHash ?? null,
              }
            : null,
          confirmation,
        });
      } catch (err) {
        req.log.error({ err, reference }, "GET /api/paystack/transactions/verify/:reference");
        const msg = err instanceof Error ? err.message : "Verification failed.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );

  /**
   * Fetch a single Paystack transaction by Paystack transaction ID (integer).
   */
  app.get<{ Params: { id: string } }>(
    "/api/paystack/transactions/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parsed = z.coerce.number().int().positive().safeParse(req.params.id);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: "id must be a positive integer." });
      }
      try {
        const data = await getTransactionById(parsed.data);
        return successEnvelope(reply, sanitizeTransactionData(data));
      } catch (err) {
        req.log.error({ err, id: req.params.id }, "GET /api/paystack/transactions/:id");
        const msg = err instanceof Error ? err.message : "Fetch failed.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );

  /**
   * List Paystack transactions (admin). Uses your integration's PAYSTACK_SECRET_KEY.
   */
  app.get(
    "/api/paystack/transactions",
    async (
      req: FastifyRequest<{
        Querystring: {
          perPage?: string;
          page?: string;
          status?: string;
          customer?: string;
          from?: string;
          to?: string;
          amount?: string;
        };
      }>,
      reply
    ) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = ListQuerySchema.safeParse({
        perPage: req.query.perPage,
        page: req.query.page,
        status: req.query.status,
        customer: req.query.customer,
        from: req.query.from,
        to: req.query.to,
        amount: req.query.amount,
      });
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const result = await listTransactions(parse.data);
        const transactions = result.data.map(sanitizeTransactionData);
        return successEnvelope(reply, { transactions, meta: result.meta });
      } catch (err) {
        req.log.error({ err }, "GET /api/paystack/transactions");
        const msg = err instanceof Error ? err.message : "List failed.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );
}
