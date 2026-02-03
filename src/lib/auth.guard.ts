import type { FastifyRequest, FastifyReply } from "fastify";
import {
  findApiKeyByRawKey,
  isOriginAllowed,
  touchLastUsed,
} from "../services/api-key.service.js";

export type AuthenticatedApiKey = {
  id: string;
  name: string;
  domains: string[];
  permissions: string[];
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  businessId: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: AuthenticatedApiKey;
  }
}

const HEADER_API_KEY = "x-api-key";
const HEADER_ORIGIN = "origin";

/**
 * Fastify preHandler that authenticates requests using the x-api-key header.
 * 1. Reads x-api-key header.
 * 2. Looks up ApiKey by hash of the key.
 * 3. Security: checks isActive, expiresAt, and (if Origin present) domains allowlist.
 * 4. Updates lastUsedAt.
 * 5. Attaches apiKey to request; returns 401 if missing or invalid.
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const rawKey = request.headers[HEADER_API_KEY];
  const keyValue = typeof rawKey === "string" ? rawKey.trim() : undefined;

  if (!keyValue) {
    return reply.status(401).send({
      success: false,
      error: "Missing API key. Provide x-api-key header.",
    });
  }

  const record = await findApiKeyByRawKey(keyValue);

  if (!record) {
    return reply.status(401).send({
      success: false,
      error: "Invalid API key.",
    });
  }

  if (!record.isActive) {
    return reply.status(401).send({
      success: false,
      error: "API key is inactive.",
    });
  }

  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    return reply.status(401).send({
      success: false,
      error: "API key has expired.",
    });
  }

  const origin = request.headers[HEADER_ORIGIN];
  const originValue = typeof origin === "string" ? origin.trim() : undefined;
  if (!isOriginAllowed(record.domains, originValue)) {
    return reply.status(403).send({
      success: false,
      error: "Origin not allowed for this API key.",
    });
  }

  touchLastUsed(record.id).catch(() => { });

  request.apiKey = {
    id: record.id,
    name: record.name,
    domains: record.domains,
    permissions: record.permissions,
    isActive: record.isActive,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    businessId: record.businessId ?? null,
  };
}

/**
 * Resolve API key when header is present and attach to request. Does not send 401/403.
 * Use for public routes that optionally show more (e.g. debug) when a valid platform key is sent.
 */
export async function resolveApiKeyIfPresent(request: FastifyRequest): Promise<void> {
  const rawKey = request.headers[HEADER_API_KEY];
  const keyValue = typeof rawKey === "string" ? rawKey.trim() : undefined;
  if (!keyValue) return;

  const record = await findApiKeyByRawKey(keyValue);
  if (!record || !record.isActive) return;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return;

  const origin = request.headers[HEADER_ORIGIN];
  const originValue = typeof origin === "string" ? origin.trim() : undefined;
  if (!isOriginAllowed(record.domains, originValue)) return;

  touchLastUsed(record.id).catch(() => { });

  request.apiKey = {
    id: record.id,
    name: record.name,
    domains: record.domains,
    permissions: record.permissions,
    isActive: record.isActive,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    businessId: record.businessId ?? null,
  };
}

/**
 * Optional helper: check if the authenticated key has a given permission.
 * Use after requireApiKey. "*" means super admin (all permissions).
 */
export function hasPermission(request: FastifyRequest, permission: string): boolean {
  const key = request.apiKey;
  if (!key) return false;
  if (key.permissions.includes("*")) return true;
  return key.permissions.includes(permission);
}

/**
 * Require that either API key or admin session is present (after resolvers have run).
 * Use in global preHandler after resolveApiKeyIfPresent + resolveAdminSessionIfPresent for protected routes.
 */
export function requireApiKeyOrSession(
  request: FastifyRequest,
  reply: FastifyReply
): boolean {
  if (request.apiKey) return true;
  if ((request as { adminSession?: unknown }).adminSession) return true;
  reply.status(401).send({
    success: false,
    error: "Not authenticated. Provide x-api-key or Authorization: Bearer <session>.",
    code: "UNAUTHORIZED",
  });
  return false;
}
