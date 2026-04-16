/**
 * Persist Paystack + Fonbnk catalog data for audits (banks, channels, tokens, fiat corridors).
 * Used by provider catalog sync (CLI, server startup, admin).
 */

import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma.js";
import {
  PAYSTACK_CHECKOUT_CHANNELS,
  isPaystackConfigured,
  listAllBanksPages,
  type BankListItem,
} from "./paystack.service.js";
import { PAYSTACK_MARKETS } from "./paystack-country-sync.service.js";

const MM_CURRENCIES = ["GHS", "KES"] as const;

export type PaystackSnapshotBrief = {
  snapshotKeys: string[];
  banksTotal: number;
  mobileMoneyTotal: number;
  markets: Array<{ slug: string; code: string; banks: number; currencies: string[] }>;
  errors: string[];
};

export type FonbnkSnapshotBrief = {
  snapshotKeys: string[];
  assetCount: number;
  fiatCorridorCount: number;
};

export type ProviderCatalogSnapshotSummary = {
  /** Null when Paystack is not configured or snapshot step failed before returning. */
  paystack: PaystackSnapshotBrief | null;
  /** Null when Fonbnk snapshot failed (DB read); other provider data may still be present. */
  fonbnk: FonbnkSnapshotBrief | null;
};

async function upsertSnapshot(params: {
  provider: string;
  snapshotKey: string;
  data: unknown;
  rowCount?: number;
  source?: string;
}): Promise<void> {
  const { provider, snapshotKey, data, rowCount, source } = params;
  await prisma.providerCatalogSnapshot.upsert({
    where: { provider_snapshotKey: { provider, snapshotKey } },
    create: {
      provider,
      snapshotKey,
      data: data as object,
      rowCount: rowCount ?? null,
      source: source ?? null,
    },
    update: {
      data: data as object,
      rowCount: rowCount ?? null,
      source: source ?? null,
    },
  });
}

/**
 * Fetch Paystack banks (all pages per market), mobile-money providers, checkout channels; upsert DB + log summary.
 */
export async function syncPaystackCatalogSnapshots(options?: {
  source?: string;
  logger?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  /** When true (e.g. `pnpm sync:providers`), print banks/channels summary to stdout. Server sync leaves this false. */
  echoToConsole?: boolean;
}): Promise<PaystackSnapshotBrief | null> {
  if (!isPaystackConfigured()) {
    options?.logger?.info?.("Provider catalog snapshots: Paystack skipped (not configured)");
    return null;
  }

  const source = options?.source ?? "provider_catalog_sync";
  const log = options?.logger;
  const echo = options?.echoToConsole === true;
  const errors: string[] = [];
  const banksByMarket: Record<string, BankListItem[]> = {};
  let banksTotal = 0;

  for (const m of PAYSTACK_MARKETS) {
    try {
      const banks = await listAllBanksPages({ country: m.slug, perPage: 100 });
      banksByMarket[m.slug] = banks;
      banksTotal += banks.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${m.slug}: ${msg}`);
      banksByMarket[m.slug] = [];
    }
  }

  await upsertSnapshot({
    provider: "PAYSTACK",
    snapshotKey: "paystack_banks_by_market",
    data: banksByMarket,
    rowCount: banksTotal,
    source,
  });

  const currenciesByMarket = PAYSTACK_MARKETS.map((market) => {
    const banks = banksByMarket[market.slug] ?? [];
    const cur = [
      ...new Set(
        banks.map((bank) => String(bank.currency).toUpperCase()).filter(Boolean)
      ),
    ].sort();
    return {
      slug: market.slug,
      code: market.code,
      name: market.name,
      banks: banks.length,
      currencies: cur,
    };
  });

  await upsertSnapshot({
    provider: "PAYSTACK",
    snapshotKey: "paystack_markets_summary",
    data: {
      documentation: "https://paystack.com/docs/api/#miscellaneous-bank",
      markets: currenciesByMarket,
    },
    rowCount: PAYSTACK_MARKETS.length,
    source,
  });

  const mobileByCurrency: Record<string, BankListItem[]> = {};
  let mobileMoneyTotal = 0;
  for (const cur of MM_CURRENCIES) {
    try {
      const mm = await listAllBanksPages({ currency: cur, type: "mobile_money", perPage: 100 });
      mobileByCurrency[cur] = mm;
      mobileMoneyTotal += mm.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`mobile_money ${cur}: ${msg}`);
      mobileByCurrency[cur] = [];
    }
  }

  await upsertSnapshot({
    provider: "PAYSTACK",
    snapshotKey: "paystack_mobile_money_by_currency",
    data: mobileByCurrency,
    rowCount: mobileMoneyTotal,
    source,
  });

  await upsertSnapshot({
    provider: "PAYSTACK",
    snapshotKey: "paystack_checkout_channels",
    data: {
      channels: [...PAYSTACK_CHECKOUT_CHANNELS],
      note: "Subset accepted by initializePayment channels[]; Paystack may enable others per merchant account.",
    },
    rowCount: PAYSTACK_CHECKOUT_CHANNELS.length,
    source,
  });

  const summary: PaystackSnapshotBrief = {
    snapshotKeys: [
      "paystack_banks_by_market",
      "paystack_markets_summary",
      "paystack_mobile_money_by_currency",
      "paystack_checkout_channels",
    ],
    banksTotal,
    mobileMoneyTotal,
    markets: currenciesByMarket.map((marketSummary) => ({
      slug: marketSummary.slug,
      code: marketSummary.code,
      banks: marketSummary.banks,
      currencies: marketSummary.currencies,
    })),
    errors,
  };

  log?.info?.(
    {
      paystack: {
        banksTotal,
        mobileMoneyTotal,
        markets: summary.markets,
        channels: PAYSTACK_CHECKOUT_CHANNELS.length,
        snapshotKeys: summary.snapshotKeys,
        errors: errors.length ? errors : undefined,
      },
    },
    "Provider catalog: Paystack snapshots stored"
  );

  if (echo) {
    console.log("\n--- Paystack catalog (fetched) ---");
    console.log("Checkout channels:", [...PAYSTACK_CHECKOUT_CHANNELS].join(", "));
    for (const row of currenciesByMarket) {
      console.log(
        `  ${row.slug} (${row.code}): ${row.banks} banks, fiat code(s): ${row.currencies.join(", ") || "—"}`
      );
    }
    console.log(
      `Mobile money providers: GHS=${mobileByCurrency.GHS?.length ?? 0}, KES=${mobileByCurrency.KES?.length ?? 0} (total ${mobileMoneyTotal})`
    );
    if (errors.length) console.warn("Paystack snapshot warnings:", errors);
    console.log("---\n");
  }

  return summary;
}

/**
 * Store Fonbnk NETWORK_ASSET list + DB Country rows (supportedFonbnk) for fiat corridors.
 */
export async function syncFonbnkCatalogSnapshots(options?: {
  source?: string;
  logger?: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  echoToConsole?: boolean;
}): Promise<FonbnkSnapshotBrief> {
  const source = options?.source ?? "provider_catalog_sync";
  const log = options?.logger;
  const echo = options?.echoToConsole === true;

  const assets = await prisma.fonbnkSupportedAsset.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      network: true,
      asset: true,
      chainId: true,
      isActive: true,
      source: true,
    },
  });

  const fiatRows = await prisma.country.findMany({
    where: { supportedFonbnk: true },
    orderBy: { code: "asc" },
    select: { code: true, name: true, currency: true, supportedPaystack: true },
  });

  const paymentRails = {
    note:
      "Fonbnk quotes use NETWORK_ASSET payout codes (see fonbnk_supported_assets). Fiat rails depend on country (often mobile money / local banking); see Fonbnk docs for coverage.",
    docsUrl: "https://docs.fonbnk.com/supported-countries-and-cryptocurrencies",
  };

  await upsertSnapshot({
    provider: "FONBNK",
    snapshotKey: "fonbnk_supported_assets",
    data: assets.map((assetRow) => ({
      code: assetRow.code,
      network: assetRow.network,
      asset: assetRow.asset,
      chainId: assetRow.chainId != null ? assetRow.chainId.toString() : null,
      isActive: assetRow.isActive,
      source: assetRow.source,
    })),
    rowCount: assets.length,
    source,
  });

  await upsertSnapshot({
    provider: "FONBNK",
    snapshotKey: "fonbnk_fiat_corridors",
    data: fiatRows,
    rowCount: fiatRows.length,
    source,
  });

  await upsertSnapshot({
    provider: "FONBNK",
    snapshotKey: "fonbnk_payment_rails",
    data: paymentRails,
    rowCount: 1,
    source,
  });

  const out: FonbnkSnapshotBrief = {
    snapshotKeys: ["fonbnk_supported_assets", "fonbnk_fiat_corridors", "fonbnk_payment_rails"],
    assetCount: assets.length,
    fiatCorridorCount: fiatRows.length,
  };

  log?.info?.(
    {
      fonbnk: {
        assets: out.assetCount,
        fiatCorridors: out.fiatCorridorCount,
        snapshotKeys: out.snapshotKeys,
      },
    },
    "Provider catalog: Fonbnk snapshots stored"
  );

  if (echo) {
    console.log("\n--- Fonbnk catalog (from DB after asset sync) ---");
    console.log(
      `NETWORK_ASSET codes: ${assets.length} (showing first 8):`,
      assets.slice(0, 8).map((assetRow) => assetRow.code).join(", ")
    );
    console.log(`Fiat corridors (Country.supportedFonbnk): ${fiatRows.length}`);
    for (const fiatCorridor of fiatRows.slice(0, 12)) {
      console.log(
        `  ${fiatCorridor.code} ${fiatCorridor.currency} — ${fiatCorridor.name} (Paystack: ${fiatCorridor.supportedPaystack})`
      );
    }
    if (fiatRows.length > 12) console.log(`  … +${fiatRows.length - 12} more`);
    console.log("Payment rails:", paymentRails.note);
    console.log("---\n");
  }

  return out;
}
