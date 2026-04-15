/**
 * Quote API: pricing endpoint (GET /api/quote) and raw swap/onramp quotes (POST).
 * GET /api/quote uses the pricing engine (buildPublicQuote) to return the platform's rate, amounts, and fees.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  buildPublicQuote,
  normalizeQuoteAssetForRequest,
} from "../../services/public-quote.service.js";
import { runPeerRampQuoteStream } from "../../services/quote-stream.service.js";
import { setStoredQuote, QUOTE_TTL_SECONDS } from "../../lib/redis.js";
import { getSwapQuote, getBestQuotes, getAllQuotes } from "../../services/swap-quote.service.js";
import { getOnrampQuote } from "../../services/onramp-quote.service.js";
import { isFonbnkConfigured } from "../../services/fonbnk.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { SWAP_QUOTE_PROVIDERS } from "../../lib/swap-quote.types.js";

/** GET /api/quote: pricing endpoint. One amount + input_side; platform returns the other amount and rate. */
const QuoteQuerySchema = z.object({
  action: z.enum(["buy", "sell", "swap"]),
  amount: z.coerce.number().positive(),
  input_side: z.enum(["from", "to"]).optional().default("from"),
  f_token: z.string().min(1),
  t_token: z.string().min(1),
  chain: z.string().min(1),
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

const OnrampQuoteBodySchema = z.object({
  country: z.string().min(1),
  chain_id: z.coerce.number().int().positive(),
  token: z.string().min(1),
  amount: z.coerce.number().positive(),
  amount_in: z.enum(["fiat", "crypto"]),
  purchase_method: z.enum(["buy", "sell"]).optional().default("buy"),
  from_address: z.string().min(1).optional(),
  token_decimals: z.coerce.number().int().nonnegative().optional(),
});

/** GET /api/quote/stream — SSE: one `quote` event per fiat as it completes, then `done`. */
const QuoteStreamQuerySchema = z.object({
  action: z.enum(["buy", "sell"]),
  amount: z.coerce.number().positive(),
  input_side: z.enum(["from", "to"]),
  chain: z.string().min(1),
  fiats: z.string().min(1).max(16_000),
  /** Crypto leg symbol (default USDC); must match peer-ramp quote params. */
  crypto: z.string().min(1).max(32).optional().default("USDC"),
});

export async function quoteApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/quote/stream",
    async (
      req: FastifyRequest<{
        Querystring: {
          action?: string;
          amount?: string;
          input_side?: string;
          chain?: string;
          fiats?: string;
          crypto?: string;
        };
      }>,
      reply
    ) => {
      const parse = QuoteStreamQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const q = parse.data;
      const fiatList = q.fiats
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (fiatList.length === 0) {
        return reply.status(400).send({ success: false, error: "fiats must list at least one code." });
      }

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const writeSse = (event: string, payload: unknown) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          /* client disconnected */
        }
      };

      try {
        await runPeerRampQuoteStream(writeSse, {
          action: q.action,
          amount: q.amount,
          inputSide: q.input_side,
          chain: q.chain,
          crypto: q.crypto,
          fiats: fiatList,
        });
      } catch (err) {
        req.log.error({ err }, "GET /api/quote/stream");
        writeSse("error", { message: err instanceof Error ? err.message : "Quote stream failed" });
      } finally {
        writeSse("done", {});
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  );

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

      if (params.from_chain === params.to_chain && params.from_token.toLowerCase().trim() === params.to_token.toLowerCase().trim()) {
        return reply.status(400).send({
          success: false,
          error: "Same token on same chain is not allowed; swap must be to a different token or chain",
          code: "SAME_TOKEN_SAME_CHAIN",
        });
      }

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

      if (params.from_chain === params.to_chain && params.from_token.toLowerCase().trim() === params.to_token.toLowerCase().trim()) {
        return reply.status(400).send({
          success: false,
          error: "Same token on same chain is not allowed; swap must be to a different token or chain",
          code: "SAME_TOKEN_SAME_CHAIN",
        });
      }

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

  /**
   * All swap quotes: same body as POST /api/quote/best but returns every provider quote (0x, squid, lifi).
   * Use in tests or UI to show multiple options (best rate vs speed, etc.).
   */
  app.post<{ Body: unknown }>(
    "/api/quote/swap/all",
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
      if (params.from_chain === params.to_chain && params.from_token.toLowerCase().trim() === params.to_token.toLowerCase().trim()) {
        return reply.status(400).send({
          success: false,
          error: "Same token on same chain is not allowed",
          code: "SAME_TOKEN_SAME_CHAIN",
        });
      }
      const result = await getAllQuotes(params);
      if (!result.ok) {
        return reply.status(502).send({ success: false, error: result.error });
      }
      return successEnvelope(reply, result.data);
    }
  );

  /**
   * Onramp quote: fiat↔crypto for buy. If requested token is in pool (Base/Ethereum USDC or ETH),
   * returns direct Fonbnk quote. If not, chains Fonbnk (fiat↔pool token) + swap (pool→requested token).
   */
  app.post<{ Body: unknown }>(
    "/api/quote/onramp",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      if (!isFonbnkConfigured()) {
        return reply.status(503).send({
          success: false,
          error: "Onramp quotes unavailable: Fonbnk not configured.",
        });
      }
      const parse = OnrampQuoteBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const result = await getOnrampQuote(parse.data);
      if (!result.ok) {
        const status = result.status ?? 502;
        return reply.status(status).send({
          success: false,
          error: result.error,
        });
      }
      return successEnvelope(reply, result.data);
    }
  );

  /**
   * GET /api/quote — Platform pricing endpoint.
   * Uses the pricing engine (provider rates + platform margin) to return the quote we will honor.
   * User sends one amount (and input_side); platform returns the other amount, exchange rate, and fees.
   * Supports buy (onramp), sell (offramp), and swap (same-chain; platform adds swap fees).
   */
  app.get(
    "/api/quote",
    async (
      req: FastifyRequest<{
        Querystring: {
          action?: string;
          amount?: string;
          input_side?: string;
          f_token?: string;
          t_token?: string;
          chain?: string;
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
      const query = parse.data;
      const actionMap = { buy: "ONRAMP" as const, sell: "OFFRAMP" as const, swap: "SWAP" as const };
      const request = {
        action: actionMap[query.action],
        inputAmount: String(query.amount),
        inputCurrency: normalizeQuoteAssetForRequest(query.f_token),
        outputCurrency: normalizeQuoteAssetForRequest(query.t_token),
        chain: query.chain.trim(),
        inputSide: query.input_side === "to" ? ("to" as const) : ("from" as const),
      };
      try {
        const result = await buildPublicQuote(request);
        if (!result.success) {
          const status = result.status ?? 400;
          return reply.status(status).send({
            success: false,
            error: result.error,
            code: result.code ?? "QUOTE_FAILED",
          });
        }
        await setStoredQuote(result.data.quoteId, JSON.stringify(result.data), QUOTE_TTL_SECONDS);
        return successEnvelope(reply, result.data);
      } catch (err) {
        req.log.error({ err, request }, "GET /api/quote");
        return errorEnvelope(reply, "Quote unavailable.", 502);
      }
    }
  );
}
