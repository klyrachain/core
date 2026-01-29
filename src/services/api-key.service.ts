import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";

const KEY_PREFIX = "sk_live_";
const KEY_PREFIX_DISPLAY_LENGTH = 7; // e.g. "sk_live" for identification

/**
 * Hash a raw API key with SHA-256. Used for storage and lookup; never store the raw key.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * Extract the first 7 characters of the key for display/identification (e.g. "sk_live").
 */
export function getKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX_DISPLAY_LENGTH);
}

/**
 * Generate a cryptographically secure random 32-byte hex string (64 hex chars).
 */
function randomHex32(): string {
  return randomBytes(32).toString("hex");
}

export type GenerateKeyOptions = {
  name: string;
  domains: string[];
  permissions?: string[];
  expiresAt?: Date | null;
};

/**
 * Generate a new API key, store its hash and prefix in the database, and return the raw key.
 * The raw key is returned ONLY once; callers must persist it (e.g. in .env) immediately.
 * Uses raw SQL because prisma.apiKey delegate can be undefined with Prisma 7 + driver adapter.
 */
export async function generateKey(options: GenerateKeyOptions): Promise<string> {
  const { name, domains, permissions = [], expiresAt = null } = options;

  const secretPart = randomHex32();
  const rawKey = `${KEY_PREFIX}${secretPart}`;

  const keyHash = hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  const id = randomUUID();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "ApiKey" ("id", "createdAt", "updatedAt", "keyHash", "keyPrefix", "name", "domains", "permissions", "isActive", "expiresAt")
    VALUES (${id}, ${now}, ${now}, ${keyHash}, ${keyPrefix}, ${name}, ${domains}, ${permissions}, true, ${expiresAt})
  `;

  return rawKey;
}

/**
 * Find an API key record by the hash of the incoming raw key. Returns null if not found.
 * Uses raw SQL because prisma.apiKey delegate can be undefined with Prisma 7 + driver adapter.
 */
export async function findApiKeyByRawKey(rawKey: string): Promise<{
  id: string;
  name: string;
  domains: string[];
  permissions: string[];
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
} | null> {
  const keyHash = hashApiKey(rawKey);
  const rows = await prisma.$queryRaw<
    { id: string; name: string; domains: string[]; permissions: string[]; isActive: boolean; expiresAt: Date | null; lastUsedAt: Date | null }[]
  >`SELECT id, name, domains, permissions, "isActive", "expiresAt", "lastUsedAt" FROM "ApiKey" WHERE "keyHash" = ${keyHash} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    domains: row.domains ?? [],
    permissions: row.permissions ?? [],
    isActive: row.isActive,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Check if the request origin is allowed by the key's domains. "*" allows any origin (or no Origin header).
 */
export function isOriginAllowed(domains: string[], origin: string | undefined): boolean {
  if (domains.includes("*")) return true;
  if (!origin || origin === "") return true; // No origin header (e.g. server-to-server) is allowed unless restricted
  const normalizedOrigin = origin.trim().toLowerCase();
  return domains.some((d) => d === "*" || normalizedOrigin === d.toLowerCase() || normalizedOrigin.endsWith("." + d.toLowerCase()));
}

/**
 * Update lastUsedAt for the given API key id. Fire-and-forget; does not throw.
 * Uses raw SQL because prisma.apiKey delegate can be undefined with Prisma 7 + driver adapter.
 */
export async function touchLastUsed(apiKeyId: string): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw`UPDATE "ApiKey" SET "lastUsedAt" = ${now}, "updatedAt" = ${now} WHERE id = ${apiKeyId}`.catch(() => {});
}
