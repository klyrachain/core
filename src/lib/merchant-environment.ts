/**
 * TEST vs LIVE isolation for /api/v1/merchant (header + API key binding).
 */
import type { FastifyRequest } from "fastify";
import type { MerchantEnvironment } from "../../prisma/generated/prisma/client.js";

export const HEADER_MERCHANT_ENV = "x-merchant-environment";

function parseEnvHeader(raw: unknown): MerchantEnvironment | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toUpperCase();
  if (t === "TEST") return "TEST";
  if (t === "LIVE") return "LIVE";
  return undefined;
}

/**
 * Resolves tenant environment. Merchant API keys may be pinned to TEST or LIVE in the DB.
 * Portal users switch via `x-merchant-environment` (default LIVE).
 */
export function resolveMerchantEnvironment(req: FastifyRequest): {
  ok: true;
  environment: MerchantEnvironment;
} | {
  ok: false;
  error: string;
  code: string;
} {
  const fromHeader = parseEnvHeader(req.headers[HEADER_MERCHANT_ENV]);
  if (req.apiKey?.businessId) {
    const keyEnv = req.apiKey.environment;
    if (keyEnv != null) {
      if (fromHeader != null && fromHeader !== keyEnv) {
        return {
          ok: false,
          error: `This API key is restricted to ${keyEnv}; header requested ${fromHeader}.`,
          code: "ENVIRONMENT_KEY_MISMATCH",
        };
      }
      return { ok: true, environment: keyEnv };
    }
    return { ok: true, environment: fromHeader ?? "LIVE" };
  }
  if (req.businessPortalTenant) {
    return { ok: true, environment: fromHeader ?? "LIVE" };
  }
  return { ok: true, environment: "LIVE" };
}

export function getMerchantEnvironmentOrThrow(req: FastifyRequest): MerchantEnvironment {
  const v = req.merchantEnvironment;
  if (v) return v;
  return "LIVE";
}
