/**
 * Public Quote API v1 — source of truth for pricing.
 * POST /api/v1/quotes — returns guaranteed price quote with fee breakdown.
 * Auth: Public (rate limiting by IP can be added later).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { setStoredQuote, QUOTE_TTL_SECONDS } from "../../../lib/redis.js";
import {
  buildPublicQuote,
  normalizeQuoteAssetForRequest,
  type QuoteRequestDto,
} from "../../../services/public-quote.service.js";
import { buildCheckoutPayoutQuotes } from "../../../services/checkout-payout-quotes.service.js";
import type { CheckoutRowSpec } from "../../../types/checkout-row-spec.js";

const QuoteRequestBodySchema = z.object({
  action: z.enum(["ONRAMP", "OFFRAMP", "SWAP"]),
  inputAmount: z.string().min(1),
  inputCurrency: z.string().min(1),
  outputCurrency: z.string().min(1),
  chain: z.string().optional(),
  /** Output chain for SWAP (Squid / viem id or cache code). Defaults to `chain` when omitted. */
  toChain: z.string().optional(),
  /** "from" = amount is paying side (default). "to" = amount is receiving side (e.g. "I want X crypto"). */
  inputSide: z.enum(["from", "to"]).optional().default("from"),
  /** EVM address for swap legs in indirect onramp/offramp quotes. */
  fromAddress: z.string().min(1).optional(),
});

const CheckoutOfframpRowSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("offramp"),
  chain: z.string().min(1),
  symbol: z.string().min(1),
  tokenAddress: z.string().min(1).optional(),
});

const CheckoutCompositeWxrpRowSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("composite_wxrp"),
});

const CheckoutRowSpecSchema = z.discriminatedUnion("kind", [
  CheckoutOfframpRowSchema,
  CheckoutCompositeWxrpRowSchema,
]);

const CheckoutQuotesBodySchema = z.object({
  inputAmount: z.string().min(1),
  inputCurrency: z.string().min(1),
  /** Optional EVM address for cross-chain swap leg (wXRP row); defaults server-side until wallet connect. */
  fromAddress: z.string().min(1).optional(),
  /** When set, replaces the default four checkout rows (order preserved). */
  rows: z.array(CheckoutRowSpecSchema).optional(),
  /** When set, only these rows are computed and returned (merge on the client). */
  refetchRowIds: z.array(z.string().min(1)).optional(),
});

export async function v1QuotesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Batch checkout quotes: Base USDC, BNB, Solana SOL, Ethereum wXRP (composite).
   * No swap URLs exposed to the client; swap runs only here.
   */
  app.post<{ Body: unknown }>(
    "/quotes/checkout",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      const parse = CheckoutQuotesBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const { inputAmount, inputCurrency, fromAddress, rows, refetchRowIds } =
        parse.data;
      try {
        const rowsOut = await buildCheckoutPayoutQuotes({
          inputAmount,
          inputCurrency,
          fromAddress,
          ...(rows != null ? { rows: rows as CheckoutRowSpec[] } : {}),
          ...(refetchRowIds != null ? { refetchRowIds } : {}),
        });
        return reply.status(200).send({ success: true, data: { rows: rowsOut } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.warn({ err }, "v1/quotes/checkout failed");
        return reply.status(502).send({
          success: false,
          error: message,
          code: "CHECKOUT_QUOTES_FAILED",
        });
      }
    }
  );

  app.post<{ Body: unknown }>(
    "/quotes",
    async (req: FastifyRequest<{ Body: unknown }>, reply) => {
      const parse = QuoteRequestBodySchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }

      const body = parse.data;
      const request: QuoteRequestDto = {
        action: body.action,
        inputAmount: body.inputAmount.trim(),
        inputCurrency: normalizeQuoteAssetForRequest(body.inputCurrency),
        outputCurrency: normalizeQuoteAssetForRequest(body.outputCurrency),
        chain: body.chain?.trim(),
        toChain: body.toChain?.trim(),
        inputSide: body.inputSide === "to" ? "to" : "from",
        fromAddress: body.fromAddress?.trim(),
      };

      const apiKey = (req as FastifyRequest & { apiKey?: { businessId?: string } }).apiKey;
      const includeDebug = !!apiKey && apiKey.businessId == null;
      try {
        const result = await buildPublicQuote(request, { includeDebug });

        if (!result.success) {
          const status = result.status ?? 400;
          return reply.status(status).send({
            success: false,
            error: result.error,
            code: result.code ?? "QUOTE_FAILED",
          });
        }

        await setStoredQuote(result.data.quoteId, JSON.stringify(result.data), QUOTE_TTL_SECONDS);

        const prices = result.data.prices;
        req.log.info(
          {
            action: body.action,
            quoteId: result.data.quoteId,
            exchangeRate: result.data.exchangeRate,
            providerPrice: prices?.providerPrice ?? result.data.basePrice,
            sellingPrice: prices?.sellingPrice ?? result.data.exchangeRate,
            avgBuyPrice: prices?.avgBuyPrice,
            input: `${result.data.input.amount} ${result.data.input.currency}`,
            output: `${result.data.output.amount} ${result.data.output.currency}`,
            platformFee: result.data.fees.platformFee,
          },
          "v1/quotes — prices for fee/profit"
        );

        return reply.status(200).send({
          success: true,
          data: result.data,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.warn({ err, body: request }, "v1/quotes buildPublicQuote failed");
        return reply.status(502).send({
          success: false,
          error: message.includes("Fonbnk") ? "Provider rate unavailable" : "Quote unavailable",
          code: "RATE_UNAVAILABLE",
        });
      }
    }
  );
}
