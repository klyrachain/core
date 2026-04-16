/**
 * KYC provider webhooks.
 * Both endpoints are OUTSIDE requireApiKeyOrSession — they use HMAC signature verification.
 *
 * POST /webhook/didit  — DIDIT status.updated events (X-Signature-V2)
 * POST /webhooks/didit — same handler (alias for console URLs that use /webhooks/)
 * POST /webhook/persona — Persona inquiry.* events (Persona-Signature)
 *
 * Always return 200 quickly; never return 500 to avoid provider retry storms.
 * Invalid signatures → 401.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  processDiditWebhook,
  processPersonaWebhook,
} from "../../services/kyc/kyc-router.service.js";

function getRawBody(request: FastifyRequest): Buffer | undefined {
  const raw = (request as { rawBody?: Buffer | string }).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  return undefined;
}

function getParsedJsonBody(request: FastifyRequest): unknown | undefined {
  const b = (request as { body?: unknown }).body;
  if (b === undefined || b === null) return undefined;
  if (typeof b === "object") return b;
  return undefined;
}

async function handleDiditWebhook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rawBody = getRawBody(req);
  const parsedBody = getParsedJsonBody(req);
  if ((!rawBody || rawBody.length === 0) && parsedBody === undefined) {
    req.log.warn("DIDIT webhook: no raw body or parsed JSON");
    return reply.status(400).send({ ok: false, error: "No body" });
  }

  const headers = req.headers as Record<string, string | string[] | undefined>;

  try {
    const ok = await processDiditWebhook(rawBody, headers, parsedBody);
    if (!ok) {
      req.log.warn("DIDIT webhook: invalid signature");
      return reply.status(401).send({ ok: false, error: "Invalid signature" });
    }
  } catch (e) {
    req.log.error({ err: e }, "DIDIT webhook: processing error");
    // Still return 200 to prevent retries for unexpected errors
  }

  return reply.status(200).send({ received: true });
}

export async function kycWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhook/didit", handleDiditWebhook);
  app.post("/webhooks/didit", handleDiditWebhook);

  app.post(
    "/webhook/persona",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const rawBody = getRawBody(req);
      if (!rawBody) {
        req.log.warn("Persona webhook: no raw body");
        return reply.status(400).send({ ok: false, error: "No body" });
      }

      const headers = req.headers as Record<string, string | string[] | undefined>;

      try {
        const ok = await processPersonaWebhook(rawBody, headers);
        if (!ok) {
          req.log.warn("Persona webhook: invalid signature");
          return reply.status(401).send({ ok: false, error: "Invalid signature" });
        }
      } catch (e) {
        req.log.error({ err: e }, "Persona webhook: processing error");
      }

      return reply.status(200).send({ received: true });
    }
  );
}
