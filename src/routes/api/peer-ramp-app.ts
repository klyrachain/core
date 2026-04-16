/**
 * Peer-ramp web app: public email OTP + session token (no API key).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import {
  requestPeerRampAppOtp,
  verifyPeerRampAppOtp,
} from "../../services/peer-ramp-app-auth.service.js";
import { getBearerToken } from "../../lib/peer-ramp-app-http.js";
import {
  getPeerRampAppLookup,
  getPeerRampAppMe,
  parsePeerRampProfileBody,
  sessionFromBearer,
  updatePeerRampAppProfile,
} from "../../services/peer-ramp-app-profile.service.js";

const EmailBody = z.object({
  email: z.string().email().max(254),
});

const VerifyBody = z.object({
  email: z.string().email().max(254),
  code: z.string().min(6).max(12),
});

export async function peerRampAppApiRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { email?: string } }>(
    "/api/peer-ramp-app/lookup",
    async (req: FastifyRequest<{ Querystring: { email?: string } }>, reply) => {
      const email = (req.query.email ?? "").trim();
      if (!email.includes("@")) {
        return reply.status(400).send({ success: false, error: "email is required" });
      }
      const data = await getPeerRampAppLookup(email);
      return successEnvelope(reply, data);
    }
  );

  app.get("/api/peer-ramp-app/me", async (req, reply) => {
    const session = sessionFromBearer(getBearerToken(req));
    if (!session) {
      return reply.status(401).send({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const profile = await getPeerRampAppMe(session.email);
    if (!profile) {
      return reply.status(404).send({ success: false, error: "User not found", code: "NOT_FOUND" });
    }
    return successEnvelope(reply, profile);
  });

  app.put("/api/peer-ramp-app/profile", async (req, reply) => {
    const session = sessionFromBearer(getBearerToken(req));
    if (!session) {
      return reply.status(401).send({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const parsed = parsePeerRampProfileBody(req.body);
    if (!parsed.ok) {
      return reply.status(400).send({ success: false, error: parsed.error });
    }
    try {
      await updatePeerRampAppProfile(session.email, parsed.data);
      const profile = await getPeerRampAppMe(session.email);
      return successEnvelope(reply, profile);
    } catch (err) {
      req.log.error({ err }, "PUT /api/peer-ramp-app/profile");
      return errorEnvelope(reply, "Could not save profile.", 500);
    }
  });

  app.post("/api/peer-ramp-app/otp/request", async (req, reply) => {
    const parse = EmailBody.safeParse(req.body && typeof req.body === "object" ? req.body : {});
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const result = await requestPeerRampAppOtp(parse.data.email);
    if (!result.ok) {
      const status =
        result.code === "COOLDOWN" ? 429 : result.code === "INVALID_EMAIL" ? 400 : 400;
      return reply.status(status).send({ success: false, error: result.error, code: result.code });
    }
    return successEnvelope(reply, { ok: true });
  });

  app.post("/api/peer-ramp-app/otp/verify", async (req, reply) => {
    const parse = VerifyBody.safeParse(req.body && typeof req.body === "object" ? req.body : {});
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const result = await verifyPeerRampAppOtp(parse.data.email, parse.data.code);
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "EXPIRED" ? 410 : 400;
      return errorEnvelope(reply, result.error, status);
    }
    return successEnvelope(reply, {
      token: result.token,
      cliSessionId: result.cliSessionId,
    });
  });
}
