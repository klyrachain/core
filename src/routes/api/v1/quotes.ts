/**
 * Public Quote API v1 — source of truth for pricing.
 * POST /api/v1/quotes — returns guaranteed price quote with fee breakdown.
 * Auth: Public (rate limiting by IP can be added later).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { setStoredQuote, QUOTE_TTL_SECONDS } from "../../../lib/redis.js";
import { buildPublicQuote, type QuoteRequestDto } from "../../../services/public-quote.service.js";

const QuoteRequestBodySchema = z.object({
  action: z.enum(["ONRAMP", "OFFRAMP", "SWAP"]),
  inputAmount: z.string().min(1),
  inputCurrency: z.string().min(1),
  outputCurrency: z.string().min(1),
  chain: z.string().optional(),
  /** "from" = amount is paying side (default). "to" = amount is receiving side (e.g. "I want X crypto"). */
  inputSide: z.enum(["from", "to"]).optional().default("from"),
});

export async function v1QuotesRoutes(app: FastifyInstance): Promise<void> {
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
        inputCurrency: body.inputCurrency.trim().toUpperCase(),
        outputCurrency: body.outputCurrency.trim().toUpperCase(),
        chain: body.chain?.trim(),
        inputSide: body.inputSide === "to" ? "to" : "from",
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
