/**
 * Admin session auth: Bearer token or cookie; used for /api/auth/me, logout, passkey add.
 * Permission checks use role→permission map (session) or API key permissions / merchant implicit (API key).
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { getSessionByToken } from "../services/admin-auth.service.js";
import { requestHasPermission } from "./permissions.js";

export type AdminSession = {
  adminId: string;
  email: string;
  name: string | null;
  role: string;
  expiresAt: Date;
};

declare module "fastify" {
  interface FastifyRequest {
    adminSession?: AdminSession;
  }
}

const HEADER_AUTHORIZATION = "authorization";
const COOKIE_SESSION = "admin_session";

function getSessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const auth = request.headers[HEADER_AUTHORIZATION];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const cookie = (request as { cookies?: Record<string, string> }).cookies?.[COOKIE_SESSION];
  if (typeof cookie === "string") return cookie.trim();
  return undefined;
}

/**
 * Resolve admin session when token/cookie is present; attach to request.adminSession. Does not 401.
 */
export async function resolveAdminSessionIfPresent(request: FastifyRequest): Promise<void> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return;
  const session = await getSessionByToken(token);
  if (session) {
    request.adminSession = session;
  }
}

/**
 * Require admin session; send 401 if missing or invalid.
 */
export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AdminSession | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) {
    reply.status(401).send({
      success: false,
      error: "Missing session. Provide Authorization: Bearer <token> or cookie admin_session.",
    });
    return null;
  }
  const session = await getSessionByToken(token);
  if (!session) {
    reply.status(401).send({
      success: false,
      error: "Invalid or expired session.",
    });
    return null;
  }
  request.adminSession = session;
  return session;
}

/**
 * Require platform API key with super_admin (permissions includes "*" or "ADMIN_INVITE").
 * Use for invite endpoint when called from dashboard (session) or from API key.
 */
export function isSuperAdmin(permissions: string[]): boolean {
  if (permissions.includes("*")) return true;
  if (permissions.includes("ADMIN_INVITE")) return true;
  return false;
}

/** Roles that can access platform dashboard. API key (platform) is treated as full access. */
export type PlatformAdminRoleName = "super_admin" | "developer" | "support" | "viewer";

/** Require platform auth: either platform API key (no businessId) or admin session. */
export function requirePlatformAuth(
  req: FastifyRequest,
  reply: FastifyReply
): boolean {
  if (req.adminSession) return true;
  if (req.apiKey && !req.apiKey.businessId) return true;
  if (req.apiKey?.businessId) {
    reply.status(403).send({ success: false, error: "This endpoint is for platform use only.", code: "FORBIDDEN" });
    return false;
  }
  reply.status(401).send({ success: false, error: "Not authenticated. Provide x-api-key (platform) or Authorization: Bearer <session>.", code: "UNAUTHORIZED" });
  return false;
}

/** Require one of the allowed roles. When auth is API key (platform), allow. When auth is session, check admin role. */
export function requireRole(
  req: FastifyRequest,
  reply: FastifyReply,
  allowedRoles: PlatformAdminRoleName[]
): boolean {
  if (req.apiKey && !req.apiKey.businessId) return true; // platform key = full access
  if (req.adminSession) {
    if (allowedRoles.includes(req.adminSession.role as PlatformAdminRoleName)) return true;
    reply.status(403).send({ success: false, error: "Your role does not allow this action.", code: "FORBIDDEN_ROLE" });
    return false;
  }
  return true; // requirePlatformAuth should have been called first
}

/** Roles allowed for read-only (GET) platform endpoints. */
export const ROLES_READ: PlatformAdminRoleName[] = ["super_admin", "developer", "support", "viewer"];
/** Roles allowed for write (PATCH, POST, DELETE) platform endpoints. */
export const ROLES_WRITE: PlatformAdminRoleName[] = ["super_admin", "developer"];

/**
 * Require the given permission. Uses role→permission map for session, API key permissions for platform key,
 * and implicit business permissions for merchant key when allowMerchant is true.
 * Call after requireApiKeyOrSession (or ensure auth is present).
 */
export function requirePermission(
  req: FastifyRequest,
  reply: FastifyReply,
  permission: string,
  options?: { allowMerchant?: boolean }
): boolean {
  const authenticated =
    !!req.apiKey || !!req.adminSession || !!req.businessPortalTenant;
  if (!authenticated) {
    reply.status(401).send({
      success: false,
      error: "Not authenticated.",
      code: "UNAUTHORIZED",
    });
    return false;
  }
  if (!requestHasPermission(req, permission, options)) {
    reply.status(403).send({
      success: false,
      error: "Your role or key does not allow this action.",
      code: "FORBIDDEN_PERMISSION",
    });
    return false;
  }
  return true;
}
