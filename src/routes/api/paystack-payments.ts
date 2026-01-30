/**
 * Paystack payment initialization (onramp). Returns authorization URL for frontend redirect.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { initializePayment, isPaystackConfigured } from "../../services/paystack.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import type { PaymentProvider, TransactionType } from "../../../prisma/generated/prisma/client.js";

const InitializeBodySchema = z.object({
  email: z.string().email(),
  amount: z.coerce.number().positive(), // in subunits (kobo/pesewas) or major – we send subunits to Paystack
  currency: z.string().min(1).optional().default("NGN"),
  callback_url: z.string().url().optional(),
  channels: z.array(z.string()).optional(),
  // Optional: link to an existing Transaction (e.g. from order webhook). If not provided, we create a PENDING Transaction.
  transaction_id: z.string().uuid().optional(),
  // If creating new: minimal context for our record (optional)
  metadata: z.record(z.union([z.string(), z.number()])).optional(),
});

export async function paystackPaymentsApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/api/paystack/payments/initialize",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
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
      const { email, amount, currency, callback_url, channels, transaction_id, metadata } = parse.data;
      // Paystack expects amount in subunits (kobo for NGN, pesewas for GHS)
      const amountSubunits = Number.isInteger(amount) && amount >= 100 ? amount : Math.round(amount * 100);
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
              f_price: 1,
              t_price: 1,
              f_chain: "ETHEREUM",
              t_chain: "ETHEREUM",
              f_token: currency,
              t_token: "USDC",
              f_provider: "PAYSTACK" as PaymentProvider,
              t_provider: "NONE",
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
