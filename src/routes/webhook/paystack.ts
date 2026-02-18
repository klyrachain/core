/**
 * Paystack webhook: verify signature, on charge.success/charge.failed update Transaction and notify admin.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../lib/prisma.js";
import {
  verifyPaystackWebhookSignature,
  verifyTransaction,
} from "../../services/paystack.service.js";
import { upsertPaystackPaymentRecord } from "../../services/paystack-payment-record.service.js";
import { sendToAdminDashboard } from "../../services/admin-dashboard.service.js";
import { triggerTransactionStatusChange } from "../../services/pusher.service.js";
import { computeTransactionFee } from "../../services/fee.service.js";
import { executeOnrampSend } from "../../services/onramp-execution.service.js";
import { onRequestPaymentSettled } from "../../services/request-settlement.service.js";

type PaystackWebhookEvent = {
  event: string;
  data: {
    reference?: string;
    status?: string;
    metadata?: { transaction_id?: string };
    [key: string]: unknown;
  };
};

function getRawBody(request: FastifyRequest): string | undefined {
  const raw = (request as { rawBody?: string }).rawBody;
  return typeof raw === "string" ? raw : undefined;
}

export async function paystackWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/webhook/paystack",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const rawBody = getRawBody(req);
      const signature = req.headers["x-paystack-signature"];
      const sig = typeof signature === "string" ? signature : "";

      if (!rawBody) {
        req.log.warn("Paystack webhook: no raw body");
        return reply.status(400).send({ ok: false });
      }
      if (!verifyPaystackWebhookSignature(rawBody, sig)) {
        req.log.warn("Paystack webhook: invalid signature");
        return reply.status(401).send({ ok: false });
      }

      const payload = req.body as PaystackWebhookEvent;
      const event = payload?.event;
      const data = payload?.data;

      if (!event || !data) {
        return reply.status(200).send({ ok: true });
      }

      // Acknowledge immediately; process async if needed
      if (event === "charge.success" || event === "charge.failed") {
        const reference = data.reference ?? (data as { reference?: string }).reference;
        const metadata = data.metadata as { transaction_id?: string } | undefined;
        const ourTransactionId = metadata?.transaction_id;

        if (ourTransactionId && reference) {
          try {
            const tx = await prisma.transaction.findUnique({
              where: { id: ourTransactionId },
            });
            if (tx && tx.providerSessionId === reference) {
              const isSuccess = event === "charge.success";
              // BUY (onramp): COMPLETED only after crypto is sent; here we only set paymentConfirmedAt.
              const isOnrampBuy = tx.type === "BUY";
              const updateData: {
                status?: "COMPLETED" | "FAILED";
                paymentConfirmedAt?: Date;
                fee?: number;
                platformFee?: number;
              } = isSuccess && isOnrampBuy
                ? { paymentConfirmedAt: new Date() }
                : { status: isSuccess ? ("COMPLETED" as const) : ("FAILED" as const) };
              if (isSuccess) {
                const feeAmount = computeTransactionFee(tx);
                if (Number.isFinite(feeAmount)) {
                  updateData.fee = feeAmount;
                  updateData.platformFee = feeAmount;
                }
              }
              await prisma.transaction.update({
                where: { id: ourTransactionId },
                data: updateData,
              });

              // --- Step 1: Paystack payment confirmed (BUY onramp) — log so we know payment went through
              if (isSuccess && isOnrampBuy) {
                req.log.info(
                  { transactionId: ourTransactionId, reference, type: tx.type },
                  "[onramp] Step 1: Paystack payment CONFIRMED. Fiat received. Transaction still PENDING until crypto is sent."
                );
                console.log(
                  `[onramp] Step 1: Paystack payment CONFIRMED for transaction ${ourTransactionId} (reference ${reference}). Proceeding to Step 2: send crypto.`
                );
              }

              try {
                const verifyData = await verifyTransaction(reference);
                await upsertPaystackPaymentRecord(verifyData, ourTransactionId);
              } catch (verifyErr) {
                req.log.warn({ err: verifyErr, reference }, "Paystack webhook: verify/upsert record failed");
              }
              const statusForDashboard = isSuccess && isOnrampBuy ? "PENDING" : (isSuccess ? "COMPLETED" : "FAILED");
              await sendToAdminDashboard({
                event: "paystack.charge." + (event === "charge.success" ? "success" : "failed"),
                data: {
                  transactionId: ourTransactionId,
                  reference,
                  status: statusForDashboard,
                  paystackEvent: event,
                },
              }).catch((err) => req.log.warn({ err }, "Admin webhook failed"));
              if (!isOnrampBuy || !isSuccess) {
                await triggerTransactionStatusChange({
                  transactionId: ourTransactionId,
                  status: (updateData.status ?? statusForDashboard) as "COMPLETED" | "FAILED" | "PENDING",
                  type: tx.type,
                }).catch(() => {});
              }

              if (isSuccess && tx.type === "BUY") {
                setImmediate(() => {
                  executeOnrampSend(ourTransactionId).then((r) => {
                    if (!r.ok) {
                      req.log.warn(
                        { err: r.error, code: r.code, transactionId: ourTransactionId },
                        "[onramp] Step 2 FAILED: crypto send failed. Transaction remains PENDING."
                      );
                      console.warn(
                        `[onramp] Step 2 FAILED: crypto send failed for ${ourTransactionId}. Error: ${r.error} (code: ${r.code ?? "—"}). Transaction remains PENDING.`
                      );
                    }
                  }).catch((err) => {
                    req.log.error({ err, transactionId: ourTransactionId }, "[onramp] Step 2 error (exception)");
                    console.error(`[onramp] Step 2 error for ${ourTransactionId}:`, err);
                  });
                });
              }
              if (isSuccess && tx.type === "REQUEST") {
                setImmediate(() => {
                  onRequestPaymentSettled({ transactionId: ourTransactionId }).then((r) => {
                    if (!r.ok) req.log.warn({ err: r.error, transactionId: ourTransactionId }, "Request settlement failed");
                  }).catch((err) => req.log.error({ err, transactionId: ourTransactionId }, "Request settlement error"));
                });
              }
            }
          } catch (err) {
            req.log.error({ err, ourTransactionId, reference }, "Paystack webhook update transaction");
          }
        }
      }

      if (event === "transfer.success" || event === "transfer.failed" || event === "transfer.reversed") {
        await sendToAdminDashboard({
          event: "paystack.transfer",
          data: { paystackEvent: event, data },
        }).catch((err) => req.log.warn({ err }, "Admin webhook failed"));
      }

      return reply.status(200).send({ ok: true });
    }
  );
}
