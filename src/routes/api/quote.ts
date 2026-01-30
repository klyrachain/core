import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getFeeForOrder } from "../../services/fee.service.js";
import { getZeroXSwapQuote } from "../../services/zero-x.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

const QuoteQuerySchema = z.object({
  action: z.enum(["buy", "sell", "request", "claim"]),
  f_amount: z.coerce.number().positive(),
  t_amount: z.coerce.number().positive(),
  f_price: z.coerce.number().nonnegative(),
  t_price: z.coerce.number().nonnegative(),
  f_chain: z.string().min(1).optional(),
  t_chain: z.string().min(1).optional(),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
});

const SwapQuoteQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  sellToken: z.string().min(1),
  buyToken: z.string().min(1),
  sellAmount: z.string().min(1),
  taker: z.string().min(1).optional(),
});

export async function quoteApiRoutes(app: FastifyInstance): Promise<void> {
  /** Token swap quote via 0x (permit2). Requires ZEROX_API_KEY. */
  app.get(
    "/api/quote/swap",
    async (
      req: FastifyRequest<{
        Querystring: {
          chainId?: string;
          sellToken?: string;
          buyToken?: string;
          sellAmount?: string;
          taker?: string;
        };
      }>,
      reply
    ) => {
      const parse = SwapQuoteQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { chainId, sellToken, buyToken, sellAmount, taker } = parse.data;
      const result = await getZeroXSwapQuote({
        chainId,
        sellToken,
        buyToken,
        sellAmount,
        taker,
      });
      if (!result.ok) {
        if (result.error.includes("not configured")) {
          return reply.status(503).send({
            success: false,
            error: result.error,
          });
        }
        return reply.status(502).send({
          success: false,
          error: result.error,
          status: result.status,
        });
      }
      return successEnvelope(reply, result.quote);
    }
  );

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
          f_chain?: string;
          t_chain?: string;
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
