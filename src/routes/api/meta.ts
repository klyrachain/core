import type { FastifyInstance } from "fastify";
import { getEnv } from "../../config/env.js";
import { successEnvelope } from "../../lib/api-helpers.js";
import { normalizeCheckoutBaseUrl } from "../../lib/checkout-base-url.js";

export async function metaApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/meta/checkout-base-url", async (_, reply) => {
    const checkoutBaseUrl = normalizeCheckoutBaseUrl(getEnv().CHECKOUT_BASE_URL);
    return successEnvelope(reply, { checkoutBaseUrl });
  });
}
