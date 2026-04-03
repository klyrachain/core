/**
 * Permission handling for platform admins (session + role), platform API keys, and businesses (merchant keys).
 * Role → permission map for platform admins; businesses get implicit permissions for their own data.
 */

import type { AuthenticatedApiKey } from "./auth.guard.js";
import type { FastifyRequest } from "fastify";

export type PlatformAdminRoleName = "super_admin" | "developer" | "support" | "viewer";

// ---------------------------------------------------------------------------
// Permission constants
// ---------------------------------------------------------------------------

/** Wildcard: all platform permissions (platform key or super_admin role). */
export const PERMISSION_ALL = "*";

/** Platform: read settings, providers, validation, platform overview, team list. */
export const PERMISSION_SETTINGS_READ = "settings:read";
export const PERMISSION_PROVIDERS_READ = "providers:read";
export const PERMISSION_PLATFORM_READ = "platform:read";
export const PERMISSION_VALIDATION_READ = "validation:read";
export const PERMISSION_TEAM_READ = "team:read";

/** Platform: write settings, providers, validation; invite team. */
export const PERMISSION_SETTINGS_WRITE = "settings:write";
export const PERMISSION_PROVIDERS_WRITE = "providers:write";
export const PERMISSION_VALIDATION_WRITE = "validation:write";
export const PERMISSION_TEAM_INVITE = "team:invite";

/** Connect: partner overview, list businesses, query transactions, payouts. Platform sees all; merchant sees own. */
export const PERMISSION_CONNECT_OVERVIEW = "connect:overview";
export const PERMISSION_CONNECT_BUSINESSES = "connect:businesses";
export const PERMISSION_CONNECT_TRANSACTIONS = "connect:transactions";
export const PERMISSION_CONNECT_PAYOUTS = "connect:payouts";

/** Access: who am I (platform or merchant context). */
export const PERMISSION_ACCESS_READ = "access:read";

/** Invoices: platform admin list, create, update, send, export. */
export const PERMISSION_INVOICES_READ = "invoices:read";
export const PERMISSION_INVOICES_WRITE = "invoices:write";

/** Business (merchant) scope: view/edit own business, handle clients (members), view own transactions and payouts. */
export const PERMISSION_BUSINESS_READ = "business:read";
export const PERMISSION_BUSINESS_WRITE = "business:write";
export const PERMISSION_BUSINESS_MEMBERS_READ = "business:members:read";
export const PERMISSION_BUSINESS_MEMBERS_WRITE = "business:members:write";
export const PERMISSION_TRANSACTIONS_READ = "transactions:read";
export const PERMISSION_PAYOUTS_READ = "payouts:read";
export const PERMISSION_PAYOUTS_WRITE = "payouts:write";

/** All platform-only permissions (for role map and platform key). */
export const PLATFORM_PERMISSIONS = [
  PERMISSION_SETTINGS_READ,
  PERMISSION_SETTINGS_WRITE,
  PERMISSION_PROVIDERS_READ,
  PERMISSION_PROVIDERS_WRITE,
  PERMISSION_PLATFORM_READ,
  PERMISSION_VALIDATION_READ,
  PERMISSION_VALIDATION_WRITE,
  PERMISSION_TEAM_READ,
  PERMISSION_TEAM_INVITE,
  PERMISSION_CONNECT_OVERVIEW,
  PERMISSION_CONNECT_BUSINESSES,
  PERMISSION_CONNECT_TRANSACTIONS,
  PERMISSION_CONNECT_PAYOUTS,
  PERMISSION_PAYOUTS_READ,
  PERMISSION_PAYOUTS_WRITE,
  PERMISSION_INVOICES_READ,
  PERMISSION_INVOICES_WRITE,
  PERMISSION_ACCESS_READ,
] as const;

/** Permissions for tenant context (merchant API key or business portal JWT). No connect:* — platform Connect is separate. */
export const MERCHANT_IMPLICIT_PERMISSIONS = [
  PERMISSION_BUSINESS_READ,
  PERMISSION_BUSINESS_WRITE,
  PERMISSION_BUSINESS_MEMBERS_READ,
  PERMISSION_BUSINESS_MEMBERS_WRITE,
  PERMISSION_TRANSACTIONS_READ,
  PERMISSION_PAYOUTS_READ,
  PERMISSION_PAYOUTS_WRITE,
  PERMISSION_INVOICES_READ,
  PERMISSION_INVOICES_WRITE,
  PERMISSION_ACCESS_READ,
] as const;

// ---------------------------------------------------------------------------
// Role → permission map (platform admins)
// ---------------------------------------------------------------------------

export const ROLE_PERMISSIONS: Record<PlatformAdminRoleName, readonly string[]> = {
  viewer: [
    PERMISSION_SETTINGS_READ,
    PERMISSION_PROVIDERS_READ,
    PERMISSION_PLATFORM_READ,
    PERMISSION_VALIDATION_READ,
    PERMISSION_TEAM_READ,
    PERMISSION_CONNECT_OVERVIEW,
    PERMISSION_CONNECT_BUSINESSES,
    PERMISSION_CONNECT_TRANSACTIONS,
    PERMISSION_CONNECT_PAYOUTS,
    PERMISSION_PAYOUTS_READ,
    PERMISSION_INVOICES_READ,
    PERMISSION_ACCESS_READ,
  ],
  support: [
    PERMISSION_SETTINGS_READ,
    PERMISSION_PROVIDERS_READ,
    PERMISSION_PLATFORM_READ,
    PERMISSION_VALIDATION_READ,
    PERMISSION_TEAM_READ,
    PERMISSION_CONNECT_OVERVIEW,
    PERMISSION_CONNECT_BUSINESSES,
    PERMISSION_CONNECT_TRANSACTIONS,
    PERMISSION_CONNECT_PAYOUTS,
    PERMISSION_PAYOUTS_READ,
    PERMISSION_INVOICES_READ,
    PERMISSION_ACCESS_READ,
  ],
  developer: [
    PERMISSION_SETTINGS_READ,
    PERMISSION_SETTINGS_WRITE,
    PERMISSION_PROVIDERS_READ,
    PERMISSION_PROVIDERS_WRITE,
    PERMISSION_PLATFORM_READ,
    PERMISSION_VALIDATION_READ,
    PERMISSION_VALIDATION_WRITE,
    PERMISSION_TEAM_READ,
    PERMISSION_CONNECT_OVERVIEW,
    PERMISSION_CONNECT_BUSINESSES,
    PERMISSION_CONNECT_TRANSACTIONS,
    PERMISSION_CONNECT_PAYOUTS,
    PERMISSION_PAYOUTS_READ,
    PERMISSION_PAYOUTS_WRITE,
    PERMISSION_INVOICES_READ,
    PERMISSION_INVOICES_WRITE,
    PERMISSION_ACCESS_READ,
  ],
  super_admin: [PERMISSION_ALL],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a permission list includes the required permission (* means all). */
export function permissionListIncludes(permissions: string[], required: string): boolean {
  if (permissions.includes(PERMISSION_ALL)) return true;
  return permissions.includes(required);
}

/** Get effective permissions for a platform admin role. Super admin always gets full access. */
export function getPermissionsForRole(role: string): string[] {
  const roleStr = String(role ?? "").trim();
  if (roleStr === "super_admin") return [PERMISSION_ALL];
  const mapped = ROLE_PERMISSIONS[roleStr as PlatformAdminRoleName];
  if (mapped) return [...mapped];
  return [];
}

/** Get effective permissions for an API key. Platform key uses key.permissions; merchant key gets MERCHANT_IMPLICIT_PERMISSIONS. */
export function getPermissionsForApiKey(apiKey: AuthenticatedApiKey): string[] {
  if (apiKey.businessId) {
    return [...MERCHANT_IMPLICIT_PERMISSIONS];
  }
  if (apiKey.permissions.includes(PERMISSION_ALL)) {
    return [...PLATFORM_PERMISSIONS];
  }
  return [...apiKey.permissions];
}

/** Get effective permissions for the current request (session or API key). Returns [] if not authenticated. */
export function getPermissionsForRequest(req: FastifyRequest): string[] {
  if (req.adminSession) {
    return getPermissionsForRole(req.adminSession.role);
  }
  if (req.apiKey) {
    return getPermissionsForApiKey(req.apiKey);
  }
  if (req.businessPortalTenant) {
    return [...MERCHANT_IMPLICIT_PERMISSIONS];
  }
  return [];
}

/** Check if request has the given permission. Session uses role map; platform key uses key.permissions; merchant key uses implicit business permissions. Super admin (role or *) always passes. */
export function requestHasPermission(
  req: FastifyRequest,
  permission: string,
  options?: { allowMerchant?: boolean }
): boolean {
  if (req.adminSession) {
    const perms = getPermissionsForRole(req.adminSession.role);
    return permissionListIncludes(perms, permission);
  }
  if (req.apiKey) {
    if (req.apiKey.businessId) {
      if (!options?.allowMerchant) return false;
      const perms = [...MERCHANT_IMPLICIT_PERMISSIONS];
      return permissionListIncludes(perms, permission);
    }
    return permissionListIncludes(req.apiKey.permissions, permission);
  }
  if (req.businessPortalTenant) {
    if (!options?.allowMerchant) return false;
    return permissionListIncludes([...MERCHANT_IMPLICIT_PERMISSIONS], permission);
  }
  return false;
}
