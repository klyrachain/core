#!/usr/bin/env node
/**
 * Run the same provider catalog sync as the 48h BullMQ job and POST /api/settings/providers/catalog/sync.
 * Calls loadEnv() first (required for Paystack checks). Persists Paystack banks/channels and Fonbnk assets/corridors into ProviderCatalogSnapshot.
 * Requires DATABASE_URL, DIRECT_URL, ENCRYPTION_KEY, optional PAYSTACK_SECRET_KEY.
 *
 * Usage: pnpm run sync:providers
 */

import "dotenv/config";
import { loadEnv } from "../src/config/env.js";
import { runProviderCatalogSync } from "../src/services/provider-catalog-sync.service.js";

async function main(): Promise<void> {
  loadEnv();
  const summary = await runProviderCatalogSync({
    fonbnkSource: "cli_sync_providers",
    logger: console,
    echoCatalogToConsole: true,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.fonbnkError && summary.fonbnk == null) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
