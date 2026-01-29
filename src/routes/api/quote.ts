import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getFeeForOrder } from "../../services/fee.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

const QuoteQuerySchema = z.object({
  action: z.enum(["buy", "sell", "request", "claim"]),
  f_amount: z.coerce.number().positive(),
  t_amount: z.coerce.number().positive(),
  f_price: z.coerce.number().nonnegative(),
  t_price: z.coerce.number().nonnegative(),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
});

export async function quoteApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/quote",
    async (
      req: FastifyRequest<{
        Querystring: {
          action?: string;
          f_amount?: string;
          t_amount?: string;
          f_price?: string;
          t_price?: string;
          f_token?: string;
          t_token?: string;
        };
      }>,
      reply
    ) => {
      const parse = QuoteQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      try {
        const quote = getFeeForOrder(parse.data);
        return successEnvelope(reply, quote);
      } catch (err) {
        req.log.error({ err }, "GET /api/quote");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
