/**
 * Map ISO 4217 codes (from ExchangeRate USD table) to flag emoji using Country + corridor maps.
 * Aligns with how we route Fonbnk quotes (currency → alpha-2).
 */

import { prisma } from "../lib/prisma.js";
import { flagEmojiForFiatCurrency } from "../lib/currency-flags.js";
import {
  CORE_FIAT_TO_COUNTRY,
  EXTENDED_FIAT_TO_COUNTRY,
} from "./quote-fiat-corridor.service.js";

let fiatToCountryCache: Map<string, string> | null = null;
let fiatToCountryCacheAt = 0;
const CACHE_MS = 60_000;

async function getFiatToCountryIso2Map(): Promise<Map<string, string>> {
  const now = Date.now();
  if (fiatToCountryCache && now - fiatToCountryCacheAt < CACHE_MS) {
    return fiatToCountryCache;
  }
  const rows = await prisma.country.findMany({
    select: { code: true, currency: true },
    orderBy: { code: "asc" },
  });
  const m = new Map<string, string>();
  for (const r of rows) {
    const cur = r.currency.trim().toUpperCase();
    if (!cur || m.has(cur)) continue;
    m.set(cur, r.code.trim().toUpperCase());
  }
  for (const [k, v] of Object.entries(EXTENDED_FIAT_TO_COUNTRY)) {
    const kk = k.toUpperCase();
    if (!m.has(kk)) m.set(kk, v.toUpperCase());
  }
  for (const [k, v] of Object.entries(CORE_FIAT_TO_COUNTRY)) {
    const kk = k.toUpperCase();
    if (!m.has(kk)) m.set(kk, v.toUpperCase());
  }
  fiatToCountryCache = m;
  fiatToCountryCacheAt = now;
  return m;
}

/** @internal tests */
export function _resetFiatToCountryCacheForTests(): void {
  fiatToCountryCache = null;
  fiatToCountryCacheAt = 0;
}

export async function buildFiatFlagsForCurrencyCodes(codes: string[]): Promise<Record<string, string>> {
  const map = await getFiatToCountryIso2Map();
  const out: Record<string, string> = {};
  for (const raw of codes) {
    const c = raw.trim().toUpperCase();
    if (!c) continue;
    const iso2 = map.get(c);
    if (!iso2) continue;
    const flag = flagEmojiForFiatCurrency(c, iso2);
    if (flag) out[c] = flag;
  }
  return out;
}
