/**
 * Business portal role checks for /api/v1/merchant. Merchant API keys bypass role checks (full access within environment).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { BusinessRole } from "../../prisma/generated/prisma/client.js";

const OWNER_ADMIN: readonly BusinessRole[] = ["OWNER", "ADMIN"];
const OWNER_ADMIN_FINANCE: readonly BusinessRole[] = ["OWNER", "ADMIN", "FINANCE"];
const OWNER_ADMIN_DEV: readonly BusinessRole[] = ["OWNER", "ADMIN", "DEVELOPER"];
const ALL_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "DEVELOPER", "FINANCE", "SUPPORT"];

export function requireMerchantRole(
  req: FastifyRequest,
  reply: FastifyReply,
  allowed: readonly BusinessRole[]
): boolean {
  if (req.apiKey?.businessId) return true;
  const role = req.businessPortalTenant?.role;
  if (!role || !allowed.includes(role)) {
    reply.status(403).send({
      success: false,
      error: "Your role does not allow this action.",
      code: "FORBIDDEN_MERCHANT_ROLE",
    });
    return false;
  }
  return true;
}

export { OWNER_ADMIN, OWNER_ADMIN_FINANCE, OWNER_ADMIN_DEV, ALL_ROLES };
