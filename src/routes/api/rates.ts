/**
 * Fiat-to-fiat exchange rates (international conversions).
 * POST /api/rates/fiat — get rate and optional converted amount via ExchangeRate-API.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  getFiatQuote,
  convertViaUsd,
  isExchangeRateConfigured,
  listUsdRateCurrencyCodes,
} from "../../services/exchange-rate.service.js";
import { buildFiatFlagsForCurrencyCodes } from "../../services/fiat-currency-flags.service.js";
import { buildFiatFlagUrlsForCodes } from "../../services/restcountries-flag-urls.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

const FiatQuoteBodySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.coerce.number().positive().optional(),
});

const FiatViaUsdBodySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.coerce.number().positive(),
});

export async function ratesApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/rates/fiat/codes
   * ISO currency codes from cached ExchangeRate `latest/USD` table (same source as quote pivot FX leg).
   */
  app.get("/api/rates/fiat/codes", async (_req: FastifyRequest, reply) => {
    if (!isExchangeRateConfigured()) {
      return reply.status(503).send({
        success: false,
        error: "Fiat rates unavailable. EXCHANGERATE_API_KEY is not set.",
      });
    }
    try {
      const data = await listUsdRateCurrencyCodes();
      let flags: Record<string, string> = {};
      try {
        flags = await buildFiatFlagsForCurrencyCodes(data.codes);
      } catch {
        flags = {};
      }
      let flagUrls: Record<string, string> = {};
      try {
        flagUrls = await buildFiatFlagUrlsForCodes(data.codes);
      } catch {
        flagUrls = {};
      }
      return successEnvelope(reply, { ...data, flags, flagUrls });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load USD rate table.";
      return errorEnvelope(reply, message, 500);
    }
  });

  /**
   * POST /api/rates/fiat
   * Fiat-to-fiat quote. Body: from, to (currency codes), optional amount.
   * Without amount returns 1:1 rate; with amount returns conversion for that amount.
   */
  app.post<{ Body: unknown }>("/api/rates/fiat", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!isExchangeRateConfigured()) {
      return reply.status(503).send({
        success: false,
        error: "Fiat rates unavailable. EXCHANGERATE_API_KEY is not set.",
      });
    }
    const parse = FiatQuoteBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { from, to, amount } = parse.data;
    try {
      const data = await getFiatQuote({ from, to, amount });
      return successEnvelope(reply, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fiat quote failed.";
      return errorEnvelope(reply, message, 500);
    }
  });

  /**
   * POST /api/rates/fiat/via-usd
   * Convert amount via USD pivot (e.g. GBP → USD → GHS). Use for consistency with Fonbnk (USD-based).
   */
  app.post<{ Body: unknown }>("/api/rates/fiat/via-usd", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!isExchangeRateConfigured()) {
      return reply.status(503).send({
        success: false,
        error: "Fiat rates unavailable. EXCHANGERATE_API_KEY is not set.",
      });
    }
    const parse = FiatViaUsdBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { from, to, amount } = parse.data;
    try {
      const data = await convertViaUsd(from, to, amount);
      return successEnvelope(reply, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fiat conversion failed.";
      return errorEnvelope(reply, message, 500);
    }
  });
}
