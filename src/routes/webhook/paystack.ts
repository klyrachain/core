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
import { settleCommercePaystackTransaction } from "../../services/commerce-paystack-settlement.service.js";
import { sendPaymentLinkPaystackSuccessEmails } from "../../services/notification.service.js";
import { getEnv } from "../../config/env.js";
import { notifyPeerRampFiatPaymentReceived } from "../../services/peer-ramp-notify.service.js";

type PaystackWebhookEvent = {
  event: string;
  data: {
    reference?: string;
    status?: string;
    metadata?: { transaction_id?: string; payer_email?: string };
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
    async (req: FastifyRequest, reply: FastifyReply) => {
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

      if (event === "charge.success" || event === "charge.failed") {
        const reference = data.reference ?? (data as { reference?: string }).reference;
        const metadata = data.metadata as { transaction_id?: string; payer_email?: string } | undefined;
        const ourTransactionId = metadata?.transaction_id;

        if (ourTransactionId && reference) {
          try {
            const tx = await prisma.transaction.findUnique({
              where: { id: ourTransactionId },
            });
            if (tx && tx.providerSessionId === reference) {
              const isSuccess = event === "charge.success";

              const paymentLink = tx.paymentLinkId
                ? await prisma.paymentLink.findUnique({
                    where: { id: tx.paymentLinkId },
                    select: {
                      id: true,
                      chargeKind: true,
                      title: true,
                      publicCode: true,
                      isOneTime: true,
                    },
                  })
                : null;

              const linkChargeKind = (paymentLink?.chargeKind ?? "FIAT").toString().toUpperCase();
              /** Commerce payment links (FIAT or CRYPTO charge kind): Paystack-settled; no on-chain send to merchant. */
              const isCommercePaystackSettlement =
                tx.type === "BUY" &&
                paymentLink != null &&
                (linkChargeKind === "FIAT" || linkChargeKind === "CRYPTO");
              /** Non–payment-link BUY (e.g. order/onramp): still uses on-chain send after Paystack. */
              const needsOnrampCryptoSend = tx.type === "BUY" && !paymentLink;

              const isOnrampBuy = tx.type === "BUY" && needsOnrampCryptoSend;

              let updateData: {
                status?: "COMPLETED" | "FAILED";
                paymentConfirmedAt?: Date;
                fee?: number;
                platformFee?: number;
              };

              let updateResult: { count: number } = { count: 0 };

              if (isSuccess && isCommercePaystackSettlement) {
                const settled = await settleCommercePaystackTransaction({
                  transactionId: ourTransactionId,
                  reference: reference!,
                  payerEmail: metadata?.payer_email?.trim() ?? null,
                });
                updateResult = { count: settled.updatedCount };
                updateData = { status: "COMPLETED", paymentConfirmedAt: new Date() };
              } else if (isSuccess && isOnrampBuy) {
                updateData = { paymentConfirmedAt: new Date() };
                const feeAmount = computeTransactionFee(tx);
                if (Number.isFinite(feeAmount)) {
                  updateData.fee = feeAmount;
                  updateData.platformFee = feeAmount;
                }
              } else {
                updateData = {
                  status: isSuccess ? ("COMPLETED" as const) : ("FAILED" as const),
                };
                if (isSuccess) {
                  const feeAmount = computeTransactionFee(tx);
                  if (Number.isFinite(feeAmount)) {
                    updateData.fee = feeAmount;
                    updateData.platformFee = feeAmount;
                  }
                }
              }

              if (!(isSuccess && isCommercePaystackSettlement)) {
                const updateWhere =
                  isSuccess && isOnrampBuy
                    ? { id: ourTransactionId, status: "PENDING" as const, paymentConfirmedAt: null }
                    : { id: ourTransactionId };

                updateResult = await prisma.transaction.updateMany({
                  where: updateWhere,
                  data: updateData,
                });
              }

              if (isSuccess && isOnrampBuy) {
                req.log.info(
                  { transactionId: ourTransactionId, reference, type: tx.type },
                  "[onramp] Step 1: Paystack payment CONFIRMED. Fiat received. Transaction still PENDING until crypto is sent."
                );
                console.log(
                  `[onramp] Step 1: Paystack payment CONFIRMED for transaction ${ourTransactionId} (reference ${reference}). Proceeding to Step 2: send crypto.`
                );
                if (updateResult.count > 0) {
                  void notifyPeerRampFiatPaymentReceived(ourTransactionId, reference).catch((e) =>
                    req.log.warn({ err: e, transactionId: ourTransactionId }, "peer-ramp fiat notify")
                  );
                }
              }

              try {
                const verifyData = await verifyTransaction(reference);
                await upsertPaystackPaymentRecord(verifyData, ourTransactionId);
              } catch (verifyErr) {
                req.log.warn({ err: verifyErr, reference }, "Paystack webhook: verify/upsert record failed");
              }

              const statusForDashboard =
                isSuccess && isOnrampBuy ? "PENDING" : isSuccess ? "COMPLETED" : "FAILED";
              await sendToAdminDashboard({
                event: "paystack.charge." + (event === "charge.success" ? "success" : "failed"),
                data: {
                  transactionId: ourTransactionId,
                  reference,
                  status: statusForDashboard,
                  paystackEvent: event,
                },
              }).catch((err) => req.log.warn({ err }, "Admin webhook failed"));

              if (
                (!isOnrampBuy || !isSuccess) &&
                !(isSuccess && isCommercePaystackSettlement)
              ) {
                await triggerTransactionStatusChange({
                  transactionId: ourTransactionId,
                  status: (updateData?.status ?? statusForDashboard) as "COMPLETED" | "FAILED" | "PENDING",
                  type: tx.type,
                }).catch(() => {});
              }

              if (
                isSuccess &&
                paymentLink &&
                updateResult.count > 0 &&
                !isCommercePaystackSettlement
              ) {
                const business = tx.businessId
                  ? await prisma.business.findUnique({
                      where: { id: tx.businessId },
                      select: { name: true, supportEmail: true },
                    })
                  : null;
                const payerEmail =
                  metadata?.payer_email?.trim() ||
                  (tx.fromIdentifier?.includes("@") ? tx.fromIdentifier.trim() : null);
                const fiatAmount = Number(tx.f_amount);
                const fiatCurrency = (tx.f_token ?? "USD").toString();
                const env = getEnv();
                void sendPaymentLinkPaystackSuccessEmails({
                  transactionId: ourTransactionId,
                  paystackReference: reference,
                  payerEmail,
                  platformPaystackEmail: env.PAYSTACK_PLATFORM_EMAIL ?? null,
                  fiatAmount,
                  fiatCurrency,
                  merchantSupportEmail: business?.supportEmail ?? null,
                  businessName: business?.name ?? "Your business",
                  linkTitle: paymentLink.title ?? "Payment link",
                  linkPublicCode: paymentLink.publicCode ?? "",
                }).catch(() => {});
              }

              if (isSuccess && tx.type === "BUY" && updateResult.count > 0 && needsOnrampCryptoSend) {
                setImmediate(() => {
                  executeOnrampSend(ourTransactionId)
                    .then((r) => {
                      if (!r.ok) {
                        req.log.warn(
                          { err: r.error, code: r.code, transactionId: ourTransactionId },
                          "[onramp] Step 2 FAILED: crypto send failed. Transaction remains PENDING."
                        );
                        console.warn(
                          `[onramp] Step 2 FAILED: crypto send failed for ${ourTransactionId}. Error: ${r.error} (code: ${r.code ?? "—"}). Transaction remains PENDING.`
                        );
                      }
                    })
                    .catch((err) => {
                      req.log.error({ err, transactionId: ourTransactionId }, "[onramp] Step 2 error (exception)");
                      console.error(`[onramp] Step 2 error for ${ourTransactionId}:`, err);
                    });
                });
              }
              if (isSuccess && tx.type === "REQUEST" && updateResult.count > 0) {
                setImmediate(() => {
                  onRequestPaymentSettled({ transactionId: ourTransactionId })
                    .then((r) => {
                      if (!r.ok) req.log.warn({ err: r.error, transactionId: ourTransactionId }, "Request settlement failed");
                    })
                    .catch((err) => req.log.error({ err, transactionId: ourTransactionId }, "Request settlement error"));
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
