/**
 * POST /api/public/contact — website contact form (Resend to inbox + user ack).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { submitPublicContact } from "../../services/public-contact.service.js";

export async function publicContactApiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/public/contact", async (req: FastifyRequest, reply) => {
    try {
      const body = req.body;
      const headers = req.headers as Record<string, string | string[] | undefined>;
      const result = await submitPublicContact(body, headers);
      if (!result.ok) {
        return reply.status(result.status).send({
          success: false,
          error: result.error,
          code: result.code,
        });
      }
      return successEnvelope(reply, { received: true });
    } catch (err) {
      req.log.error({ err }, "POST /api/public/contact");
      return errorEnvelope(reply, "Could not submit contact form.", 500);
    }
  });
}
