import type { FastifyInstance, FastifyRequest } from "fastify";
import { getEnv } from "../../config/env.js";
import { successEnvelope } from "../../lib/api-helpers.js";
import { normalizeCheckoutBaseUrl } from "../../lib/checkout-base-url.js";

export async function metaApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/meta/checkout-base-url", async (_, reply) => {
    const checkoutBaseUrl = normalizeCheckoutBaseUrl(getEnv().CHECKOUT_BASE_URL);
    return successEnvelope(reply, { checkoutBaseUrl });
  });

  app.get("/api/meta/verification-webhooks", async (req: FastifyRequest, reply) => {
    const xfProto = req.headers["x-forwarded-proto"];
    const protoRaw = typeof xfProto === "string" ? xfProto.split(",")[0]?.trim() : "";
    const proto = protoRaw === "https" ? "https" : "http";
    const xfHost = req.headers["x-forwarded-host"] ?? req.headers.host;
    const hostRaw = typeof xfHost === "string" ? xfHost.split(",")[0]?.trim() : "";
    const base =
      hostRaw.length > 0 ? `${proto}://${hostRaw}`.replace(/\/+$/, "") : "";
    const rel = {
      didit: "/webhook/didit",
      diditAlt: "/webhooks/didit",
      persona: "/webhook/persona",
    };
    const absolute = base
      ? {
          diditUrl: `${base}${rel.didit}`,
          diditUrlAlt: `${base}${rel.diditAlt}`,
          personaUrl: `${base}${rel.persona}`,
        }
      : {};
    return successEnvelope(reply, { ...rel, ...absolute });
  });
}
