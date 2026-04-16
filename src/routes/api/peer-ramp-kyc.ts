/**
 * Peer-ramp KYC API routes (Bearer auth — same pattern as peer-ramp-app).
 * These routes are excluded from requireApiKeyOrSession (see server.ts bypass).
 *
 * POST /api/peer-ramp-app/kyc/init    — create / resume a KYC session
 * POST /api/peer-ramp-app/kyc/sync    — pull Didit decision API and update DB (callback / manual refresh)
 * GET  /api/peer-ramp-app/kyc/status  — get current KYC status for the session user
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { getBearerToken } from "../../lib/peer-ramp-app-http.js";
import { sessionFromBearer } from "../../services/peer-ramp-app-profile.service.js";
import {
  initKycSession,
  getKycStatus,
  syncPeerRampDiditFromDecisionApi,
} from "../../services/kyc/kyc-router.service.js";
import { getEnv } from "../../config/env.js";

export async function peerRampKycApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/peer-ramp-app/kyc/init
   * Headers: Authorization: Bearer <token>, x-kyc-service: <opaque service id> (optional if DEFAULT_KYC_SERVICE is set)
   * Returns: { provider, verificationUrl?, inquiryId?, sessionToken?, environmentId? }
   */
  app.post("/api/peer-ramp-app/kyc/init", async (req: FastifyRequest<{ Body?: { callbackUrl?: string } }>, reply) => {
    const session = sessionFromBearer(getBearerToken(req));
    if (!session) {
      return reply.status(401).send({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const headerService = (req.headers["x-kyc-service"] ?? "") as string;
    const serviceId = headerService || getEnv().DEFAULT_KYC_SERVICE || "";
    if (!serviceId) {
      return reply.status(400).send({ success: false, error: "x-kyc-service header is required (no DEFAULT_KYC_SERVICE configured)", code: "MISSING_SERVICE" });
    }

    const bodyCb =
      typeof req.body === "object" &&
      req.body &&
      typeof (req.body as { callbackUrl?: unknown }).callbackUrl === "string"
        ? String((req.body as { callbackUrl: string }).callbackUrl).trim()
        : "";
    const fallback = (getEnv().FRONTEND_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    const callbackUrl =
      bodyCb && /^https?:\/\//i.test(bodyCb)
        ? bodyCb
        : `${fallback}/kyc`;

    try {
      const result = await initKycSession(session.email, serviceId, callbackUrl);
      return successEnvelope(reply, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "KYC init failed";
      req.log.error({ err: e }, "POST /api/peer-ramp-app/kyc/init");
      if (msg.includes("not configured") || msg.includes("KYC_SERVICE_MAP")) {
        return errorEnvelope(reply, "KYC service is not configured.", 503);
      }
      return errorEnvelope(reply, msg, 500);
    }
  });

  /**
   * POST /api/peer-ramp-app/kyc/sync
   * Body: { verificationSessionId?: string } — when omitted, uses last stored Didit session id.
   * Pulls decision from Didit API and updates DB (for localhost / missed webhooks).
   */
  app.post(
    "/api/peer-ramp-app/kyc/sync",
    async (req: FastifyRequest<{ Body?: { verificationSessionId?: string } }>, reply) => {
      const session = sessionFromBearer(getBearerToken(req));
      if (!session) {
        return reply.status(401).send({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const body = typeof req.body === "object" && req.body ? req.body : {};
      const verificationSessionId =
        typeof (body as { verificationSessionId?: unknown }).verificationSessionId === "string"
          ? (body as { verificationSessionId: string }).verificationSessionId
          : undefined;

      try {
        const result = await syncPeerRampDiditFromDecisionApi(session.email, verificationSessionId);
        if (!result.ok) {
          const status =
            result.code === "SESSION_MISMATCH" ? 403 : result.code === "NO_DIDIT_SESSION" ? 400 : 502;
          return reply.status(status).send({
            success: false,
            error: result.error,
            code: result.code,
          });
        }
        return successEnvelope(reply, result.kyc);
      } catch (e) {
        req.log.error({ err: e }, "POST /api/peer-ramp-app/kyc/sync");
        return errorEnvelope(reply, "KYC sync failed.", 500);
      }
    }
  );

  /**
   * GET /api/peer-ramp-app/kyc/status
   * Returns: { kycStatus, kycVerifiedAt }
   */
  app.get("/api/peer-ramp-app/kyc/status", async (req: FastifyRequest, reply) => {
    const session = sessionFromBearer(getBearerToken(req));
    if (!session) {
      return reply.status(401).send({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    try {
      const status = await getKycStatus(session.email);
      return successEnvelope(reply, status);
    } catch (e) {
      req.log.error({ err: e }, "GET /api/peer-ramp-app/kyc/status");
      return errorEnvelope(reply, "Could not fetch KYC status.", 500);
    }
  });
}
