/**
 * Sync Paystack market availability into Country.supportedPaystack by probing the banks API per market.
 * Paystack does not expose a single “list all countries” endpoint we rely on; we use documented country slugs.
 */

import { prisma } from "../lib/prisma.js";
import { invalidateFiatCountryCache } from "./quote-fiat-corridor.service.js";
import { isPaystackConfigured, listBanks } from "./paystack.service.js";

/** Paystack `country` query values for GET /bank — map to our ISO Country rows. */
export const PAYSTACK_MARKETS: { slug: string; code: string; name: string; defaultCurrency: string }[] = [
  { slug: "nigeria", code: "NG", name: "Nigeria", defaultCurrency: "NGN" },
  { slug: "ghana", code: "GH", name: "Ghana", defaultCurrency: "GHS" },
  { slug: "kenya", code: "KE", name: "Kenya", defaultCurrency: "KES" },
  { slug: "south_africa", code: "ZA", name: "South Africa", defaultCurrency: "ZAR" },
  { slug: "cote_d_ivoire", code: "CI", name: "Côte d'Ivoire", defaultCurrency: "XOF" },
];

export type PaystackCountrySyncResult = {
  checked: number;
  markedSupported: number;
  markedUnsupported: number;
  errors: string[];
};

/**
 * For each known Paystack market, call list banks; if any bank exists, set supportedPaystack on Country.
 * Creates minimal Country rows when missing (supportedFonbnk: false); does not clear supportedFonbnk on existing rows.
 */
export async function syncPaystackMetadataToCountry(): Promise<PaystackCountrySyncResult> {
  if (!isPaystackConfigured()) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }
  const out: PaystackCountrySyncResult = {
    checked: 0,
    markedSupported: 0,
    markedUnsupported: 0,
    errors: [],
  };

  for (const m of PAYSTACK_MARKETS) {
    out.checked += 1;
    try {
      const { data } = await listBanks({ country: m.slug, perPage: 5 });
      const supported = data.length > 0;
      const currency =
        (data[0]?.currency && String(data[0].currency).trim().toUpperCase()) || m.defaultCurrency;

      await prisma.country.upsert({
        where: { code: m.code },
        create: {
          code: m.code,
          name: m.name,
          currency,
          supportedFonbnk: false,
          supportedPaystack: supported,
        },
        update: {
          supportedPaystack: supported,
          currency,
        },
      });
      if (supported) out.markedSupported += 1;
      else out.markedUnsupported += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${m.code}: ${msg}`);
    }
  }

  invalidateFiatCountryCache();
  return out;
}
