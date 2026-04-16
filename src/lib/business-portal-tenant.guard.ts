import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./prisma.js";
import type { BusinessRole } from "../../prisma/generated/prisma/client.js";
import { verifyBusinessPortalToken } from "./business-session.js";
import { tagRequestLogWithTenant } from "./request-log-store.js";
import { resolveMerchantEnvironment } from "./merchant-environment.js";

export type BusinessPortalTenant = {
  userId: string;
  businessId: string;
  role: BusinessRole;
};

declare module "fastify" {
  interface FastifyRequest {
    businessPortalTenant?: BusinessPortalTenant;
    /** Set by handleMerchantV1Auth for /api/v1/merchant (TEST vs LIVE). */
    merchantEnvironment?: import("../../prisma/generated/prisma/client.js").MerchantEnvironment;
  }
}

const UUID = z.string().uuid();

/**
 * Auth for /api/v1/merchant only: merchant x-api-key, or Bearer business-portal JWT + X-Business-Id + active membership.
 * Platform admin session alone is rejected (no tenant context).
 */
export async function handleMerchantV1Auth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (request.adminSession && !request.apiKey?.businessId) {
    reply.status(403).send({
      success: false,
      error: "Merchant API requires a business API key or business portal token with X-Business-Id.",
      code: "MERCHANT_CONTEXT_REQUIRED",
    });
    return false;
  }

  if (request.apiKey?.businessId) {
    const raw = request.headers["x-business-id"];
    const xBid = typeof raw === "string" ? raw.trim() : "";
    if (xBid && xBid !== request.apiKey.businessId) {
      reply.status(403).send({
        success: false,
        error: "X-Business-Id must match the business for this API key.",
        code: "BUSINESS_ID_MISMATCH",
      });
      return false;
    }
    if (request.requestLogId && request.apiKey.businessId) {
      tagRequestLogWithTenant(request.requestLogId, request.apiKey.businessId);
    }
    const envKey = resolveMerchantEnvironment(request);
    if (!envKey.ok) {
      reply.status(400).send({ success: false, error: envKey.error, code: envKey.code });
      return false;
    }
    request.merchantEnvironment = envKey.environment;
    return true;
  }

  const auth = request.headers.authorization;
  if (typeof auth !== "string" || !auth.toLowerCase().startsWith("bearer ")) {
    reply.status(401).send({
      success: false,
      error: "Provide x-api-key (merchant) or Authorization: Bearer <portal JWT> with X-Business-Id.",
      code: "MERCHANT_UNAUTHORIZED",
    });
    return false;
  }

  const token = auth.slice(7).trim();
  const verified = verifyBusinessPortalToken(token);
  if (!verified) {
    reply.status(401).send({
      success: false,
      error: "Invalid or expired business portal token.",
      code: "PORTAL_TOKEN_INVALID",
    });
    return false;
  }

  const rawBid = request.headers["x-business-id"];
  const businessId = typeof rawBid === "string" ? rawBid.trim() : "";
  if (!UUID.safeParse(businessId).success) {
    reply.status(400).send({
      success: false,
      error: "Header X-Business-Id is required and must be a valid UUID.",
      code: "MISSING_BUSINESS_ID",
    });
    return false;
  }

  const member = await prisma.businessMember.findFirst({
    where: { userId: verified.userId, businessId, isActive: true },
    select: { id: true, role: true },
  });
  if (!member) {
    reply.status(403).send({
      success: false,
      error: "You are not an active member of this business.",
      code: "BUSINESS_ACCESS_DENIED",
    });
    return false;
  }

  request.businessPortalTenant = { userId: verified.userId, businessId, role: member.role };
  if (request.requestLogId) {
    tagRequestLogWithTenant(request.requestLogId, businessId);
  }
  const envPortal = resolveMerchantEnvironment(request);
  if (!envPortal.ok) {
    reply.status(400).send({ success: false, error: envPortal.error, code: envPortal.code });
    return false;
  }
  request.merchantEnvironment = envPortal.environment;
  return true;
}

export function getMerchantV1BusinessId(request: FastifyRequest): string {
  const fromKey = request.apiKey?.businessId;
  if (fromKey) return fromKey;
  const fromPortal = request.businessPortalTenant?.businessId;
  if (fromPortal) return fromPortal;
  throw new Error("getMerchantV1BusinessId: auth should have run first");
}

/** When merchant routes or dual-auth handlers need to scope resources to the tenant (if any). */
export function getOptionalMerchantBusinessId(request: FastifyRequest): string | undefined {
  if (request.apiKey?.businessId) return request.apiKey.businessId;
  if (request.businessPortalTenant?.businessId) return request.businessPortalTenant.businessId;
  return undefined;
}

/**
 * For `/api/invoices` (non-v1): resolve business portal JWT + X-Business-Id into `businessPortalTenant`,
 * or attach merchant environment for merchant API keys. Platform admin session / platform API key skips.
 */
export async function resolveInvoicesPortalTenantIfEligible(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.adminSession) {
    return;
  }
  if (request.apiKey?.businessId) {
    const envKey = resolveMerchantEnvironment(request);
    if (!envKey.ok) {
      reply.status(400).send({ success: false, error: envKey.error, code: envKey.code });
      return;
    }
    request.merchantEnvironment = envKey.environment;
    return;
  }
  if (request.apiKey && !request.apiKey.businessId) {
    return;
  }
  if (request.businessPortalTenant) {
    return;
  }

  const auth = request.headers.authorization;
  if (typeof auth !== "string" || !auth.toLowerCase().startsWith("bearer ")) {
    return;
  }

  const token = auth.slice(7).trim();
  const verified = verifyBusinessPortalToken(token);
  if (!verified) {
    return;
  }

  const rawBid = request.headers["x-business-id"];
  const businessId = typeof rawBid === "string" ? rawBid.trim() : "";
  if (!UUID.safeParse(businessId).success) {
    reply.status(400).send({
      success: false,
      error: "Header X-Business-Id is required and must be a valid UUID.",
      code: "MISSING_BUSINESS_ID",
    });
    return;
  }

  const member = await prisma.businessMember.findFirst({
    where: { userId: verified.userId, businessId, isActive: true },
    select: { id: true, role: true },
  });
  if (!member) {
    reply.status(403).send({
      success: false,
      error: "You are not an active member of this business.",
      code: "BUSINESS_ACCESS_DENIED",
    });
    return;
  }

  request.businessPortalTenant = {
    userId: verified.userId,
    businessId,
    role: member.role,
  };
  if (request.requestLogId) {
    tagRequestLogWithTenant(request.requestLogId, businessId);
  }
  const envPortal = resolveMerchantEnvironment(request);
  if (!envPortal.ok) {
    reply.status(400).send({ success: false, error: envPortal.error, code: envPortal.code });
    return;
  }
  request.merchantEnvironment = envPortal.environment;
}
