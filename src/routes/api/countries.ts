/**
 * Supported countries for onramp/offramp and payouts.
 * GET /api/countries returns all countries (code, name, currency, supportedFonbnk, supportedPaystack).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope } from "../../lib/api-helpers.js";

const ListCountriesQuerySchema = z.object({
  supported: z.enum(["fonbnk", "paystack", "any"]).optional(),
});

export async function countriesApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/countries
   * Returns supported countries with code, name, currency, and provider flags.
   * Query: ?supported=fonbnk | paystack | any — filter by provider.
   */
  app.get<{ Querystring: unknown }>(
    "/api/countries",
    async (req: FastifyRequest<{ Querystring: unknown }>, reply) => {
      const parse = ListCountriesQuerySchema.safeParse(req.query);
      const supported = parse.success ? parse.data.supported : undefined;

      const where =
        supported === "fonbnk"
          ? { supportedFonbnk: true }
          : supported === "paystack"
            ? { supportedPaystack: true }
            : supported === "any"
              ? { OR: [{ supportedFonbnk: true }, { supportedPaystack: true }] }
              : {};

      const countries = await prisma.country.findMany({
        where,
        orderBy: [{ code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          currency: true,
          supportedFonbnk: true,
          supportedPaystack: true,
        },
      });

      return successEnvelope(reply, { countries });
    }
  );
}
