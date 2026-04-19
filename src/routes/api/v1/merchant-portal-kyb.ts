/**
 * Business portal KYB (Didit) — Bearer JWT + X-Business-Id.
 * POST/GET /api/v1/merchant/kyb/*
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { KybStatus } from "../../../../prisma/generated/prisma/client.js";
import { prisma } from "../../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../../lib/api-helpers.js";
import { requirePermission } from "../../../lib/admin-auth.guard.js";
import { PERMISSION_BUSINESS_READ } from "../../../lib/permissions.js";
import { getMerchantV1BusinessId } from "../../../lib/business-portal-tenant.guard.js";
import { isFirstActiveMemberOfBusiness } from "../../../lib/business-first-member.js";
import { getDiditWorkflowId } from "../../../services/kyc/didit.service.js";
import {
  initPortalBusinessKybSession,
  getPortalBusinessKybStatus,
  syncPortalBusinessKybFromDecisionApi,
  resolvePortalKybCallbackUrl,
} from "../../../services/kyc/portal-kyb.service.js";

export function registerMerchantPortalKybRoutes(app: FastifyInstance): void {
  app.post(
    "/kyb/init",
    async (req: FastifyRequest<{ Body?: { callbackUrl?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const tenant = req.businessPortalTenant;
        if (!tenant?.userId) {
          return errorEnvelope(reply, "Business portal session required.", 401);
        }

        const businessId = getMerchantV1BusinessId(req);

        const firstOk = await isFirstActiveMemberOfBusiness(tenant.userId, businessId);
        if (!firstOk) {
          return reply.status(403).send({
            success: false,
            error: "Only the founding team lead can start company verification for this business.",
            code: "KYB_FORBIDDEN",
          });
        }

        const business = await prisma.business.findUnique({
          where: { id: businessId },
          select: { kybStatus: true, supportEmail: true },
        });
        if (!business) {
          return errorEnvelope(reply, "Business not found.", 404);
        }
        if (business.kybStatus === KybStatus.APPROVED) {
          return errorEnvelope(reply, "Company verification is already approved.", 400);
        }
        if (business.kybStatus === KybStatus.RESTRICTED) {
          return reply.status(403).send({
            success: false,
            error: "Company verification cannot be started for this business status.",
            code: "KYB_BLOCKED",
          });
        }

        const user = await prisma.user.findUnique({
          where: { id: tenant.userId },
          select: { email: true },
        });
        if (!user?.email) {
          return errorEnvelope(reply, "User not found.", 404);
        }

        const bodyCb =
          typeof req.body === "object" &&
          req.body &&
          typeof (req.body as { callbackUrl?: unknown }).callbackUrl === "string"
            ? String((req.body as { callbackUrl: string }).callbackUrl).trim()
            : "";
        const callbackUrl = resolvePortalKybCallbackUrl(bodyCb);

        const correlation = business.supportEmail?.trim() || user.email;
        const result = await initPortalBusinessKybSession(businessId, correlation, callbackUrl);
        return successEnvelope(reply, {
          provider: result.provider,
          verificationUrl: result.verificationUrl,
          externalId: result.externalId,
          inquiryId: result.inquiryId,
          sessionToken: result.sessionToken,
          environmentId: result.environmentId,
          workflowId: getDiditWorkflowId("kyb"),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "KYB init failed";
        req.log.error({ err: e }, "POST /api/v1/merchant/kyb/init");
        if (msg.includes("not configured") || msg.includes("DIDIT_")) {
          return errorEnvelope(reply, "Company verification is not configured.", 503);
        }
        return errorEnvelope(reply, msg, 500);
      }
    }
  );

  app.get("/kyb/status", async (req, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
      const businessId = getMerchantV1BusinessId(req);
      const kyb = await getPortalBusinessKybStatus(businessId);
      if (!kyb) {
        return errorEnvelope(reply, "Business not found.", 404);
      }
      return successEnvelope(reply, {
        kybStatus: kyb.kybStatus,
      });
    } catch (e) {
      req.log.error({ err: e }, "GET /api/v1/merchant/kyb/status");
      return errorEnvelope(reply, "Could not fetch company verification status.", 500);
    }
  });

  app.post(
    "/kyb/sync",
    async (req: FastifyRequest<{ Body?: { verificationSessionId?: string } }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_BUSINESS_READ, { allowMerchant: true })) return;
        const businessId = getMerchantV1BusinessId(req);

        const body = typeof req.body === "object" && req.body ? req.body : {};
        const verificationSessionId =
          typeof (body as { verificationSessionId?: unknown }).verificationSessionId === "string"
            ? (body as { verificationSessionId: string }).verificationSessionId
            : undefined;

        const result = await syncPortalBusinessKybFromDecisionApi(businessId, verificationSessionId);
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
          kybStatus: result.kyb.kybStatus,
        });
      } catch (e) {
        req.log.error({ err: e }, "POST /api/v1/merchant/kyb/sync");
        return errorEnvelope(reply, "Company verification sync failed.", 500);
      }
    }
  );
}
