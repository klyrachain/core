import type { FastifyInstance, FastifyRequest } from "fastify";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { listProviderRailMetadata } from "../../services/provider-metadata.service.js";

export async function providerMetadataApiRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get(
    "/api/provider-metadata",
    async (
      req: FastifyRequest<{
        Querystring: {
          providerCode?: string;
          country?: string;
          currency?: string;
        };
      }>,
      reply
    ) => {
      try {
        const providerCode = req.query.providerCode?.trim().toLowerCase();
        const country = req.query.country?.trim().toUpperCase();
        const currency = req.query.currency?.trim().toUpperCase();
        const rows = listProviderRailMetadata().filter((row) => {
          if (providerCode && row.providerCode !== providerCode) return false;
          if (country && !row.supportedCountries.includes(country)) return false;
          if (currency && !row.supportedFiatCurrencies.includes(currency)) return false;
          return true;
        });
        return successEnvelope(reply, rows);
      } catch (err) {
        req.log.error({ err }, "GET /api/provider-metadata");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
