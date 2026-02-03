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
              const newStatus = event === "charge.success" ? ("COMPLETED" as const) : ("FAILED" as const);
              const updateData: { status: "COMPLETED" | "FAILED"; fee?: number; platformFee?: number } = { status: newStatus };
              if (newStatus === "COMPLETED") {
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
              try {
                const verifyData = await verifyTransaction(reference);
                await upsertPaystackPaymentRecord(verifyData, ourTransactionId);
              } catch (verifyErr) {
                req.log.warn({ err: verifyErr, reference }, "Paystack webhook: verify/upsert record failed");
              }
              await sendToAdminDashboard({
                event: "paystack.charge." + (event === "charge.success" ? "success" : "failed"),
                data: {
                  transactionId: ourTransactionId,
                  reference,
                  status: newStatus,
                  paystackEvent: event,
                },
              }).catch((err) => req.log.warn({ err }, "Admin webhook failed"));
              await triggerTransactionStatusChange({
                transactionId: ourTransactionId,
                status: newStatus,
                type: tx.type,
              }).catch(() => {});

              if (newStatus === "COMPLETED" && tx.type === "BUY") {
                setImmediate(() => {
                  executeOnrampSend(ourTransactionId).then((r) => {
                    if (!r.ok) req.log.warn({ err: r.error, code: r.code, transactionId: ourTransactionId }, "Onramp send failed");
                  }).catch((err) => req.log.error({ err, transactionId: ourTransactionId }, "Onramp send error"));
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
