/**
 * Business portal member KYC (Didit) — Bearer JWT + X-Business-Id.
 * GET/POST /api/v1/merchant/kyc/*
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import { PERMISSION_BUSINESS_READ } from "../../../lib/permissions.js";
import { getDiditWorkflowId } from "../../../services/kyc/didit.service.js";
import {
  initPortalMemberKycSession,
  getPortalMemberKycStatus,
  syncPortalDiditFromDecisionApi,
  resolvePortalKycCallbackUrl,
} from "../../../services/kyc/portal-kyc.service.js";

export function registerMerchantPortalKycRoutes(app: FastifyInstance): void {
  app.post(
    "/kyc/init",
    async (req: FastifyRequest<{ Body?: { callbackUrl?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const tenant = req.businessPortalTenant;
        if (!tenant?.userId) {
          return errorEnvelope(reply, "Business portal session required.", 401);
        }

        const bodyCb =
          typeof req.body === "object" &&
          req.body &&
          typeof (req.body as { callbackUrl?: unknown }).callbackUrl === "string"
            ? String((req.body as { callbackUrl: string }).callbackUrl).trim()
            : "";
        const callbackUrl = resolvePortalKycCallbackUrl(bodyCb);

        const user = await prisma.user.findUnique({
          where: { id: tenant.userId },
          select: { id: true, email: true },
        });
        if (!user?.email) {
          return errorEnvelope(reply, "User not found.", 404);
        }

        const result = await initPortalMemberKycSession(user.id, user.email, callbackUrl);
        return successEnvelope(reply, {
          provider: result.provider,
          verificationUrl: result.verificationUrl,
          externalId: result.externalId,
          inquiryId: result.inquiryId,
          sessionToken: result.sessionToken,
          environmentId: result.environmentId,
          workflowId: getDiditWorkflowId("portal_kyc"),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "KYC init failed";
        req.log.error({ err: e }, "POST /api/v1/merchant/kyc/init");
        if (msg.includes("not configured") || msg.includes("DIDIT_")) {
          return errorEnvelope(reply, "Identity verification is not configured.", 503);
        }
        return errorEnvelope(reply, msg, 500);
      }
    }
  );

  app.get("/kyc/status", async (req, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      const tenant = req.businessPortalTenant;
      if (!tenant?.userId) {
        return errorEnvelope(reply, "Business portal session required.", 401);
      }
      const kyc = await getPortalMemberKycStatus(tenant.userId);
      return successEnvelope(reply, {
        portalKycStatus: kyc.portalKycStatus,
        portalKycVerifiedAt: kyc.portalKycVerifiedAt?.toISOString() ?? null,
        portalKycProvider: kyc.portalKycProvider,
      });
    } catch (e) {
      req.log.error({ err: e }, "GET /api/v1/merchant/kyc/status");
      return errorEnvelope(reply, "Could not fetch verification status.", 500);
    }
  });

  app.post(
    "/kyc/sync",
    async (req: FastifyRequest<{ Body?: { verificationSessionId?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const tenant = req.businessPortalTenant;
        if (!tenant?.userId) {
          return errorEnvelope(reply, "Business portal session required.", 401);
        }

        const body = typeof req.body === "object" && req.body ? req.body : {};
        const verificationSessionId =
          typeof (body as { verificationSessionId?: unknown }).verificationSessionId === "string"
            ? (body as { verificationSessionId: string }).verificationSessionId
            : undefined;

        const user = await prisma.user.findUnique({
          where: { id: tenant.userId },
          select: { email: true },
        });
        if (!user?.email) {
          return errorEnvelope(reply, "User not found.", 404);
        }

        const result = await syncPortalDiditFromDecisionApi(
          tenant.userId,
          user.email,
          verificationSessionId
        );
        if (!result.ok) {
          const status =
            result.code === "SESSION_MISMATCH" ? 403 : result.code === "NO_DIDIT_SESSION" ? 400 : 502;
          return reply.status(status).send({
            success: false,
            error: result.error,
            code: result.code,
          });
        }
        return successEnvelope(reply, {
          portalKycStatus: result.kyc.portalKycStatus,
          portalKycVerifiedAt: result.kyc.portalKycVerifiedAt?.toISOString() ?? null,
          portalKycProvider: result.kyc.portalKycProvider,
        });
      } catch (e) {
        req.log.error({ err: e }, "POST /api/v1/merchant/kyc/sync");
        return errorEnvelope(reply, "Verification sync failed.", 500);
      }
    }
  );
}
