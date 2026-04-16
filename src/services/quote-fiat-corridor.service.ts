/**
 * Fiat corridor for public quotes: map ISO fiat → Fonbnk country, detect fiat vs crypto in query params,
 * and support GHS + ExchangeRate-API pivot when Fonbnk has no direct offer.
 */

import { prisma } from "../lib/prisma.js";

/** Legacy static map (Fonbnk corridors). Merged with DB and EXTENDED_FIAT_TO_COUNTRY. */
export const CORE_FIAT_TO_COUNTRY: Record<string, string> = {
  GHS: "GH",
  NGN: "NG",
  KES: "KE",
  TZS: "TZ",
  UGX: "UG",
  RWF: "RW",
  ZMW: "ZM",
  ZAR: "ZA",
  XOF: "CI",
  XAF: "CM",
  BWP: "BW",
  MZN: "MZ",
  USD: "GH",
};

/** Major ISO fiats not always seeded in Country — default alpha-2 for Fonbnk-style routing where applicable. */
export const EXTENDED_FIAT_TO_COUNTRY: Record<string, string> = {
  EUR: "DE",
  GBP: "GB",
  CAD: "CA",
  AUD: "AU",
  JPY: "JP",
  CHF: "CH",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  PLN: "PL",
  AED: "AE",
  SAR: "SA",
  INR: "IN",
  CNY: "CN",
  MXN: "MX",
  BRL: "BR",
  TRY: "TR",
  PHP: "PH",
  IDR: "ID",
  THB: "TH",
  MYR: "MY",
  SGD: "SG",
  NZD: "NZ",
  HKD: "HK",
  KRW: "KR",
};

/** Symbols treated as crypto for quote param normalization (3-letter overlap with fiat). */
const CRYPTO_SYMBOL_DENYLIST = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "TRX",
  "DOT",
  "MATIC",
  "POL",
  "AVAX",
  "LINK",
  "UNI",
  "ATOM",
  "XLM",
  "LTC",
  "BCH",
  "ETC",
  "USDC",
  "USDT",
  "DAI",
  "WBTC",
  "WETH",
  "ARB",
  "OP",
]);

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

let countryByCurrencyCache: Map<string, string> | null = null;
let countryCacheLoadedAt = 0;
const CACHE_MS = 60_000;

async function refreshCountryByCurrencyCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (countryByCurrencyCache && now - countryCacheLoadedAt < CACHE_MS) {
    return countryByCurrencyCache;
  }
  const rows = await prisma.country.findMany({
    where: { supportedFonbnk: true },
    select: { code: true, currency: true },
  });
  const m = new Map<string, string>();
  for (const r of rows) {
    const cur = r.currency.trim().toUpperCase();
    if (cur) m.set(cur, r.code.trim().toUpperCase());
  }
  countryByCurrencyCache = m;
  countryCacheLoadedAt = now;
  return m;
}

/** Invalidate cache after provider sync (optional). */
export function invalidateFiatCountryCache(): void {
  countryByCurrencyCache = null;
  void import("./fiat-currency-flags.service.js").then((m) => m._resetFiatToCountryCacheForTests());
}

/**
 * Resolve ISO 3166-1 alpha-2 country for Fonbnk quote calls.
 * Prefers DB Country row (supportedFonbnk) by currency, then extended static map, then core map, default GH.
 */
export async function resolveCountryCodeForFiatCurrency(fiat: string): Promise<string> {
  const c = fiat.trim().toUpperCase();
  if (!c) return "GH";
  const fromDb = (await refreshCountryByCurrencyCache()).get(c);
  if (fromDb) return fromDb;
  if (EXTENDED_FIAT_TO_COUNTRY[c]) return EXTENDED_FIAT_TO_COUNTRY[c];
  if (CORE_FIAT_TO_COUNTRY[c]) return CORE_FIAT_TO_COUNTRY[c];
  return "GH";
}

/** Synchronous fiat check for URL/query normalization (before async quote). */
export function isKnownFiatCurrencyCode(code: string): boolean {
  const t = code.trim();
  if (ADDRESS_REGEX.test(t)) return false;
  const c = t.toUpperCase();
  if (CRYPTO_SYMBOL_DENYLIST.has(c)) return false;
  if (CORE_FIAT_TO_COUNTRY[c] || EXTENDED_FIAT_TO_COUNTRY[c]) return true;
  if (c.length === 3 && /^[A-Z]{3}$/.test(c)) return true;
  return false;
}

/** Base fiat/country for Fonbnk pivot when direct corridor fails (GHS / Ghana). */
export const QUOTE_PIVOT_FIAT = "GHS";
export const QUOTE_PIVOT_COUNTRY = "GH";

/** True when a seeded Country row marks this ISO fiat as Fonbnk-supported (direct corridor). */
export async function isFiatSupportedByFonbnkInDb(fiat: string): Promise<boolean> {
  const c = fiat.trim().toUpperCase();
  if (!c) return false;
  const row = await prisma.country.findFirst({
    where: { currency: c, supportedFonbnk: true },
    select: { id: true },
  });
  return row != null;
}
