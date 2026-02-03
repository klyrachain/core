/**
 * Paystack transfers (admin): list transfers from Paystack API for dashboard.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { listTransfers, isPaystackConfigured } from "../../services/paystack.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";

const ListQuerySchema = z.object({
  perPage: z.coerce.number().min(1).max(100).optional(),
  page: z.coerce.number().min(1).optional(),
  customer: z.coerce.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function paystackTransfersApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * List transfers from Paystack (admin dashboard). Fetches live data from Paystack API.
   */
  app.get(
    "/api/paystack/transfers",
    async (
      req: FastifyRequest<{
        Querystring: { perPage?: string; page?: string; customer?: string; from?: string; to?: string };
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
        customer: req.query.customer,
        from: req.query.from,
        to: req.query.to,
      });
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const result = await listTransfers(parse.data);
        return successEnvelope(reply, { transfers: result.data, meta: result.meta });
      } catch (err) {
        req.log.error({ err }, "GET /api/paystack/transfers");
        const msg = err instanceof Error ? err.message : "List transfers failed.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );
}
