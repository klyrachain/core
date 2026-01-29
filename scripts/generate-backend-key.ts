#!/usr/bin/env node
/**
 * Generate a master API key for the Backend Server and print it to the console.
 * Copy the key to your .env as e.g. CORE_API_KEY=sk_live_...
 *
 * Usage: pnpm tsx scripts/generate-backend-key.ts
 * Requires: DATABASE_URL (or DIRECT_URL) in .env; run db:migrate first if you added ApiKey.
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../src/config/env.js";
import { hashApiKey, getKeyPrefix } from "../src/services/api-key.service.js";

async function main(): Promise<void> {
  try {
    loadEnv();
  } catch (err) {
    console.error("Env validation failed. Ensure DATABASE_URL (and DIRECT_URL if using migrations) are set.");
    process.exit(1);
  }

  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
  if (!connectionString) {
    console.error("DATABASE_URL or DIRECT_URL must be set in .env");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  const KEY_PREFIX = "sk_live_";
  const secretPart = randomBytes(32).toString("hex");
  const rawKey = `${KEY_PREFIX}${secretPart}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  // Use raw SQL to avoid Prisma client delegate issues when run as standalone script
  const id = crypto.randomUUID();
  const now = new Date();
  const domains = ["*"];
  const permissions = ["*"];
  await prisma.$executeRaw`
    INSERT INTO "ApiKey" ("id", "createdAt", "updatedAt", "keyHash", "keyPrefix", "name", "domains", "permissions", "isActive")
    VALUES (${id}, ${now}, ${now}, ${keyHash}, ${keyPrefix}, ${"Backend Server Primary"}, ${domains}, ${permissions}, true)
  `;

  await prisma.$disconnect();

  console.log("\n========================================");
  console.log("Backend Server Primary API Key (show once)");
  console.log("========================================");
  console.log(rawKey);
  console.log("========================================");
  console.log("\nAdd to your .env:");
  console.log(`CORE_API_KEY=${rawKey}`);
  console.log("\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
