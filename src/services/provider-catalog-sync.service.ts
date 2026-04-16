/**
 * Shared provider catalog refresh: Fonbnk supported assets (DB) + Paystack → Country flags.
 * Used by admin POST routes, BullMQ repeatable job, and `pnpm run sync:providers`.
 */

import type { FastifyBaseLogger } from "fastify";
import { syncFonbnkSupportedAssetsInDb } from "./fonbnk.service.js";
import { syncPaystackMetadataToCountry } from "./paystack-country-sync.service.js";
import { isPaystackConfigured } from "./paystack.service.js";
import {
  syncFonbnkCatalogSnapshots,
  syncPaystackCatalogSnapshots,
  type FonbnkSnapshotBrief,
  type PaystackSnapshotBrief,
  type ProviderCatalogSnapshotSummary,
} from "./provider-catalog-snapshot.service.js";

export type ProviderCatalogSyncSummary = {
  fonbnk: { upserted: number } | null;
  fonbnkError?: string;
  paystack: Awaited<ReturnType<typeof syncPaystackMetadataToCountry>> | null;
  paystackError?: string;
  /** Banks/channels (Paystack) + assets/corridors (Fonbnk) stored in ProviderCatalogSnapshot */
  snapshots?: ProviderCatalogSnapshotSummary;
  snapshotsError?: string;
};

export async function runProviderCatalogSync(options?: {
  fonbnkCodes?: string[];
  fonbnkSource?: string;
  logger?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  /** Only for CLI: print catalog tables to stdout (server/job keeps false). */
  echoCatalogToConsole?: boolean;
}): Promise<ProviderCatalogSyncSummary> {
  const log = options?.logger;
  const src = options?.fonbnkSource ?? "provider_catalog_sync";
  const echo = options?.echoCatalogToConsole === true;
  const summary: ProviderCatalogSyncSummary = {
    fonbnk: null,
    paystack: null,
  };

  try {
    summary.fonbnk = await syncFonbnkSupportedAssetsInDb({
      codes: options?.fonbnkCodes,
      source: src,
    });
    log?.info({ fonbnk: summary.fonbnk }, "Provider catalog: Fonbnk sync done");
  } catch (e) {
    summary.fonbnkError = e instanceof Error ? e.message : String(e);
    log?.warn({ err: e }, "Provider catalog: Fonbnk sync failed");
  }

  let fonbnkSnap: FonbnkSnapshotBrief | null = null;
  try {
    fonbnkSnap = await syncFonbnkCatalogSnapshots({
      source: src,
      logger: log,
      echoToConsole: echo,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    summary.snapshotsError = summary.snapshotsError
      ? `${summary.snapshotsError}; fonbnk snapshots: ${msg}`
      : `fonbnk snapshots: ${msg}`;
    log?.warn({ err: e }, "Provider catalog: Fonbnk catalog snapshots failed");
  }

  let paystackSnap: PaystackSnapshotBrief | null = null;
  if (isPaystackConfigured()) {
    try {
      summary.paystack = await syncPaystackMetadataToCountry();
      log?.info({ paystack: summary.paystack }, "Provider catalog: Paystack country sync done");
    } catch (e) {
      summary.paystackError = e instanceof Error ? e.message : String(e);
      log?.warn({ err: e }, "Provider catalog: Paystack sync failed");
    }
    try {
      paystackSnap = await syncPaystackCatalogSnapshots({
        source: src,
        logger: log,
        echoToConsole: echo,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.snapshotsError = summary.snapshotsError
        ? `${summary.snapshotsError}; paystack snapshots: ${msg}`
        : `paystack snapshots: ${msg}`;
      log?.warn({ err: e }, "Provider catalog: Paystack catalog snapshots failed");
    }
  } else {
    summary.paystackError = "skipped (PAYSTACK_SECRET_KEY not set)";
    log?.info("Provider catalog: Paystack sync skipped (not configured)");
  }

  if (fonbnkSnap != null || paystackSnap != null) {
    summary.snapshots = { fonbnk: fonbnkSnap, paystack: paystackSnap };
  }

  return summary;
}
