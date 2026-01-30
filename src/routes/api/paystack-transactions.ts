/**
 * Paystack transactions: verify by reference, fetch by ID, list (admin).
 * All require x-api-key; backend uses PAYSTACK_SECRET_KEY to call Paystack.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  verifyTransaction,
  getTransactionById,
  listTransactions,
  isPaystackConfigured,
  sanitizeTransactionData,
} from "../../services/paystack.service.js";
import { upsertPaystackPaymentRecord } from "../../services/paystack-payment-record.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

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
        const data = await verifyTransaction(reference);
        const ourTransactionId = (data.metadata?.transaction_id as string) ?? null;
        await upsertPaystackPaymentRecord(data, ourTransactionId);
        return successEnvelope(reply, sanitizeTransactionData(data));
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
