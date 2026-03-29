/**
 * Paystack payment initialization (onramp). Returns authorization URL for frontend redirect.
 * For onramp (fiat → crypto): pass transaction_id from an order (webhook/order or test/onramp/order)
 * that has toIdentifier set to the recipient wallet; otherwise executeOnrampSend will fail (no destination).
 * Creating a transaction here when transaction_id is omitted is for ad-hoc payments only and lacks
 * toIdentifier/f_chain/t_chain — use order-first flow for full onramp.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { initializePayment, isPaystackConfigured } from "../../services/paystack.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import type {
  MerchantEnvironment,
  PaymentProvider,
  TransactionType,
} from "../../../prisma/generated/prisma/client.js";
import { paymentLinkAmountIsOpen } from "../../lib/payment-link-amount-open.js";

const InitializeBodySchema = z
  .object({
    email: z.string().email(),
    amount: z.coerce.number().positive().optional(),
    currency: z.string().min(1).optional().default("NGN"),
    callback_url: z.string().url().optional(),
    channels: z.array(z.string()).optional(),
    transaction_id: z.string().uuid().optional(),
    /** Commerce: server loads amount/currency from this PaymentLink (fixed) or validates open link + payer amount. */
    payment_link_id: z.string().uuid().optional(),
    metadata: z.record(z.union([z.string(), z.number()])).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.payment_link_id && !data.transaction_id && data.amount == null) {
      ctx.addIssue({
        code: "custom",
        message: "amount is required unless payment_link_id or transaction_id is set.",
        path: ["amount"],
      });
    }
  });

export async function paystackPaymentsApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/api/paystack/payments/initialize",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = InitializeBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const {
        email,
        amount: bodyAmount,
        currency: bodyCurrency,
        callback_url,
        channels,
        transaction_id,
        payment_link_id,
        metadata,
      } = parse.data;

      let currency = (bodyCurrency ?? "NGN").trim().toUpperCase();
      let majorAmount: number | undefined = bodyAmount;
      let commerceLink: {
        id: string;
        businessId: string;
        environment: MerchantEnvironment;
        amount: unknown;
        currency: string;
      } | null = null;

      if (payment_link_id) {
        const link = await prisma.paymentLink.findFirst({
          where: { id: payment_link_id.trim(), isActive: true },
          select: {
            id: true,
            businessId: true,
            environment: true,
            amount: true,
            currency: true,
          },
        });
        if (!link) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found or inactive.",
          });
        }
        commerceLink = link;
        const open = paymentLinkAmountIsOpen(link.amount);
        currency = link.currency.trim().toUpperCase();
        if (open) {
          if (majorAmount == null) {
            return reply.status(400).send({
              success: false,
              error: "amount is required for open-amount payment links.",
            });
          }
        } else {
          if (link.amount == null) {
            return reply.status(400).send({
              success: false,
              error: "Invalid payment link amount.",
            });
          }
          majorAmount = Number(link.amount);
        }
      }

      if (majorAmount == null || !Number.isFinite(majorAmount) || majorAmount <= 0) {
        return reply.status(400).send({
          success: false,
          error: "Invalid amount.",
        });
      }

      const amountSubunits = payment_link_id
        ? Math.round(majorAmount * 100)
        : Number.isInteger(majorAmount) && majorAmount >= 100
          ? majorAmount
          : Math.round(majorAmount * 100);
      if (amountSubunits < 100) {
        return reply.status(400).send({
          success: false,
          error: "Amount must be at least 1 unit (100 subunits).",
        });
      }

      let ourTransactionId = transaction_id;
      if (!ourTransactionId) {
        try {
          const tx = await prisma.transaction.create({
            data: {
              type: "BUY" as TransactionType,
              status: "PENDING",
              fromIdentifier: email,
              fromType: "EMAIL",
              f_amount: amountSubunits / 100,
              t_amount: 0,
              exchangeRate: 1,
              f_tokenPriceUsd: 1,
              t_tokenPriceUsd: 1,
              f_chain: "MOMO",
              t_chain: "BASE",
              f_token: currency,
              t_token: "USDC",
              f_provider: "PAYSTACK" as PaymentProvider,
              t_provider: "NONE",
              providerPrice: null,
              businessId: commerceLink?.businessId ?? null,
              environment: commerceLink?.environment ?? "LIVE",
              paymentLinkId: commerceLink?.id ?? null,
            },
          });
          ourTransactionId = tx.id;
        } catch (err) {
          req.log.error({ err }, "Create transaction for Paystack initialize");
          return errorEnvelope(reply, "Failed to create transaction.", 500);
        }
      } else {
        const existing = await prisma.transaction.findUnique({
          where: { id: ourTransactionId },
        });
        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: "Transaction not found.",
          });
        }
        await prisma.transaction.update({
          where: { id: ourTransactionId },
          data: { providerSessionId: null }, // will set to Paystack reference after init
        });
      }

      try {
        const result = await initializePayment({
          email,
          amount: amountSubunits,
          currency,
          callback_url,
          channels,
          metadata: {
            transaction_id: ourTransactionId,
            ...(metadata ?? {}),
          },
        });

        await prisma.transaction.update({
          where: { id: ourTransactionId },
          data: { providerSessionId: result.reference },
        });

        return successEnvelope(
          reply,
          {
            authorization_url: result.authorization_url,
            access_code: result.access_code,
            reference: result.reference,
            transaction_id: ourTransactionId,
          },
          201
        );
      } catch (err) {
        req.log.error({ err }, "Paystack initialize");
        const msg = err instanceof Error ? err.message : "Paystack initialization failed.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );
}
