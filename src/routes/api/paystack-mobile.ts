/**
 * Paystack mobile money API: list mobile money providers (telcos) for a currency.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { listMobileMoneyProviders, isPaystackConfigured } from "../../services/paystack.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

const ListMobileProvidersQuerySchema = z.object({
  currency: z.enum(["GHS", "KES"]).describe("Currency for mobile money (GHS Ghana, KES Kenya)"),
  perPage: z.coerce.number().min(1).max(100).optional(),
});

export async function paystackMobileApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/paystack/mobile/providers",
    async (
      req: FastifyRequest<{
        Querystring: { currency?: string; perPage?: string };
      }>,
      reply
    ) => {
      if (!isPaystackConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY.",
        });
      }
      const parse = ListMobileProvidersQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const result = await listMobileMoneyProviders({
          currency: parse.data.currency,
          perPage: parse.data.perPage,
        });
        return successEnvelope(reply, { providers: result.data, meta: result.meta });
      } catch (err) {
        req.log.error({ err }, "GET /api/paystack/mobile/providers");
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        return errorEnvelope(reply, msg, 502);
      }
    }
  );
}
