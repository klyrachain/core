/**
 * Quote API: swap quotes (0x, Squid, LiFi) and fee quotes.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getFeeForOrder } from "../../services/fee.service.js";
import { getSwapQuote, getBestQuotes } from "../../services/swap-quote.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { SWAP_QUOTE_PROVIDERS } from "../../lib/swap-quote.types.js";

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

const SwapQuoteBodySchema = z.object({
  provider: z.enum(SWAP_QUOTE_PROVIDERS),
  from_token: z.string().min(1),
  to_token: z.string().min(1),
  amount: z.string().min(1),
  from_chain: z.coerce.number().int().positive(),
  to_chain: z.coerce.number().int().positive(),
  from_address: z.string().min(1).optional(),
  to_address: z.string().optional(),
  slippage: z.coerce.number().nonnegative().optional(),
});

const BestQuoteBodySchema = z.object({
  from_token: z.string().min(1),
  to_token: z.string().min(1),
  amount: z.string().min(1),
  from_chain: z.coerce.number().int().positive(),
  to_chain: z.coerce.number().int().positive(),
  from_address: z.string().min(1),
  to_address: z.string().optional(),
  slippage: z.coerce.number().nonnegative().optional(),
});

export async function quoteApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Unified swap quote: single POST endpoint; provider (0x, squid, lifi) determines router.
   * Returns normalized quote with chains, cross_chain/same_chain, token_type, amounts, optional next_quote_timer, optional transaction/calldata.
   */
  app.post<{ Body: unknown }>(
    "/api/quote/swap",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      const parse = SwapQuoteBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const params = parse.data;

      if ((params.provider === "squid" || params.provider === "lifi") && !params.from_address?.trim()) {
        return reply.status(400).send({
          success: false,
          error: "from_address is required when provider is squid or lifi",
        });
      }

      const result = await getSwapQuote(params);
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

  /**
   * Best quote: calls all applicable providers (same-chain: 0x, Squid, LiFi; cross-chain: Squid, LiFi)
   * and returns the best by rate (to_amount), plus an optional second quote if competitive (within 5% of best).
   * User can choose best rate or faster execution (estimated_duration_seconds).
   */
  app.post<{ Body: unknown }>(
    "/api/quote/best",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      const parse = BestQuoteBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const params = parse.data;

      const result = await getBestQuotes(params);
      if (!result.ok) {
        return reply.status(502).send({
          success: false,
          error: result.error,
        });
      }
      return successEnvelope(reply, result.data);
    }
  );

  /** Fee quote for order (buy/sell/request/claim). */
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
