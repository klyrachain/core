/**
 * Fiat-to-fiat exchange rates (e.g. ExchangeRate-API).
 * Use USD as pivot for conversions to Fonbnk currencies (GHS, NGN, etc.).
 * Bulk `latest/USD` is cached in-process to avoid N pair requests per quote batch.
 * https://www.exchangerate-api.com/
 */

import { getEnv } from "../config/env.js";
import type { FiatQuoteRequest, FiatQuoteResponse } from "../lib/rates.types.js";

const BASE_URL = "https://v6.exchangerate-api.com/v6";

const DEFAULT_USD_TABLE_TTL_MS = 10 * 60 * 1000;

function getApiKey(): string {
  const key = getEnv().EXCHANGERATE_API_KEY?.trim() ?? "";
  if (!key) {
    throw new Error("Missing EXCHANGERATE_API_KEY. Set it for fiat conversion.");
  }
  return key;
}

function getUsdTableCacheTtlMs(): number {
  const v = getEnv().EXCHANGERATE_CACHE_TTL_MS;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_TABLE_TTL_MS;
}

export function isExchangeRateConfigured(): boolean {
  try {
    const key = getEnv().EXCHANGERATE_API_KEY?.trim();
    return !!key;
  } catch {
    return false;
  }
}

export type LatestUsdRatesResult = {
  baseCode: string;
  /** Uppercase ISO codes; values = units of that currency per 1 USD. */
  rates: Record<string, number>;
  timeLastUpdateUtc?: string;
};

type MemoryCache = {
  rates: Record<string, number>;
  fetchedAt: number;
  timeLastUpdateUtc?: string;
};

let usdRatesMemoryCache: MemoryCache | null = null;
let usdRatesInflight: Promise<LatestUsdRatesResult> | null = null;

function normalizeRatesUppercase(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.trim().toUpperCase()] = v;
  }
  return out;
}

/**
 * Single HTTP call: all currencies vs USD. Not cached — use getCachedUsdConversionRates.
 */
export async function fetchLatestUsdConversionRates(): Promise<LatestUsdRatesResult> {
  const apiKey = getApiKey();
  const url = `${BASE_URL}/${apiKey}/latest/USD`;
  const httpResponse = await fetch(url, { headers: { Accept: "application/json" } });
  const apiResponse = (await httpResponse.json()) as {
    result?: string;
    base_code?: string;
    conversion_rates?: Record<string, number>;
    time_last_update_utc?: string;
    "error-type"?: string;
  };

  if (!httpResponse.ok || apiResponse?.result !== "success" || !apiResponse.conversion_rates) {
    const errorType =
      apiResponse["error-type"] ?? apiResponse?.result ?? httpResponse.statusText;
    throw new Error(`ExchangeRate API latest/USD error: ${errorType}`);
  }

  return {
    baseCode: apiResponse.base_code ?? "USD",
    rates: normalizeRatesUppercase(apiResponse.conversion_rates),
    timeLastUpdateUtc: apiResponse.time_last_update_utc,
  };
}

/**
 * Cached `latest/USD` table (TTL from EXCHANGERATE_CACHE_TTL_MS, default 10 min).
 * Coalesces concurrent callers into one upstream request.
 */
export async function getCachedUsdConversionRates(): Promise<LatestUsdRatesResult> {
  getApiKey();
  const now = Date.now();
  const ttl = getUsdTableCacheTtlMs();
  if (usdRatesMemoryCache && now - usdRatesMemoryCache.fetchedAt < ttl) {
    return {
      baseCode: "USD",
      rates: usdRatesMemoryCache.rates,
      timeLastUpdateUtc: usdRatesMemoryCache.timeLastUpdateUtc,
    };
  }
  if (usdRatesInflight) return usdRatesInflight;

  usdRatesInflight = fetchLatestUsdConversionRates()
    .then((data) => {
      usdRatesMemoryCache = {
        rates: data.rates,
        fetchedAt: Date.now(),
        timeLastUpdateUtc: data.timeLastUpdateUtc,
      };
      return data;
    })
    .finally(() => {
      usdRatesInflight = null;
    });

  return usdRatesInflight;
}

/** @internal — tests */
export function _resetUsdRatesCacheForTests(): void {
  usdRatesMemoryCache = null;
  usdRatesInflight = null;
}

/**
 * Convert `amount` of `fromCurrency` to `toCurrency` using USD-base table
 * (`conversion_rates[X]` = units of X per 1 USD).
 * Pricing engine applies margin once elsewhere on the resulting fiat-per-crypto value.
 */
export function convertAmountViaUsdRates(
  fromCurrency: string,
  toCurrency: string,
  amount: number,
  rates: Record<string, number>
): number {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) return amount;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("amount must be a finite non-negative number.");
  }
  const rf = rates[from];
  const rt = rates[to];
  if (rf == null || !Number.isFinite(rf) || rf <= 0) {
    throw new Error(`Missing or invalid USD conversion rate for ${from}`);
  }
  if (rt == null || !Number.isFinite(rt) || rt <= 0) {
    throw new Error(`Missing or invalid USD conversion rate for ${to}`);
  }
  const usd = amount / rf;
  return usd * rt;
}

/**
 * Sorted list of ISO codes present in the cached USD table (for CLI / GET /api/rates/fiat/codes).
 */
export async function listUsdRateCurrencyCodes(): Promise<{
  codes: string[];
  timeLastUpdateUtc?: string;
}> {
  const { rates, timeLastUpdateUtc } = await getCachedUsdConversionRates();
  const codes = Object.keys(rates).sort((a, b) => a.localeCompare(b));
  return { codes, timeLastUpdateUtc };
}

/**
 * Fetch fiat-to-fiat quote. Returns rate (1 from = rate to) and optionally
 * converted amount when request.amount is provided.
 * Use USD as pivot when converting to Fonbnk currencies (e.g. GBP → USD → GHS).
 */
export async function getFiatQuote(
  request: FiatQuoteRequest
): Promise<FiatQuoteResponse> {
  const from = String(request.from ?? "").trim().toUpperCase();
  const to = String(request.to ?? "").trim().toUpperCase();
  const amount = request.amount != null ? Number(request.amount) : undefined;

  if (!from || !to) {
    throw new Error("from and to currency codes are required.");
  }

  const apiKey = getApiKey();
  const path =
    amount != null && Number.isFinite(amount) && amount > 0
      ? `pair/${from}/${to}/${amount}`
      : `pair/${from}/${to}`;
  const url = `${BASE_URL}/${apiKey}/${path}`;

  const httpResponse = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const apiResponse = (await httpResponse.json()) as {
    result?: string;
    conversion_rate?: number;
    conversion_result?: number;
    base_code?: string;
    target_code?: string;
    time_last_update_utc?: string;
    "error-type"?: string;
  };

  if (!httpResponse.ok || apiResponse?.result !== "success") {
    const errorType =
      apiResponse["error-type"] ?? apiResponse?.result ?? httpResponse.statusText;
    throw new Error(`ExchangeRate API error: ${errorType}`);
  }

  const rate = Number(apiResponse.conversion_rate);
  if (!Number.isFinite(rate)) {
    throw new Error("Invalid conversion rate from ExchangeRate API.");
  }

  const response: FiatQuoteResponse = {
    from: apiResponse.base_code ?? from,
    to: apiResponse.target_code ?? to,
    rate,
    timeLastUpdateUtc: apiResponse.time_last_update_utc,
  };

  if (
    amount != null &&
    Number.isFinite(amount) &&
    apiResponse.conversion_result != null
  ) {
    response.amount = amount;
    response.convertedAmount = Number(apiResponse.conversion_result);
  }

  return response;
}

/**
 * Convert amount from one currency to another via USD pivot.
 * Prefers cached `latest/USD` table (one bulk fetch per TTL); falls back to pair endpoints if needed.
 */
export async function convertViaUsd(
  fromCurrency: string,
  toCurrency: string,
  amount: number
): Promise<{ amount: number; rate: number; from: string; to: string }> {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) {
    return { amount, rate: 1, from, to };
  }

  if (isExchangeRateConfigured()) {
    try {
      const { rates } = await getCachedUsdConversionRates();
      const converted = convertAmountViaUsdRates(from, to, amount, rates);
      if (Number.isFinite(converted) && converted >= 0) {
        const combinedRate = amount > 0 ? converted / amount : 0;
        return { amount: converted, rate: combinedRate, from, to };
      }
    } catch {
      /* fall through to pair API */
    }
  }

  if (from === "USD") {
    const quote = await getFiatQuote({ from: "USD", to, amount });
    return {
      amount: quote.convertedAmount ?? amount * quote.rate,
      rate: quote.rate,
      from: "USD",
      to,
    };
  }
  if (to === "USD") {
    const quote = await getFiatQuote({ from, to: "USD", amount });
    return {
      amount: quote.convertedAmount ?? amount * quote.rate,
      rate: quote.rate,
      from,
      to: "USD",
    };
  }
  const toUsd = await getFiatQuote({ from, to: "USD", amount });
  const usdAmount = toUsd.convertedAmount ?? amount * toUsd.rate;
  const fromUsd = await getFiatQuote({ from: "USD", to, amount: usdAmount });
  const finalAmount = fromUsd.convertedAmount ?? usdAmount * fromUsd.rate;
  const combinedRate = amount > 0 ? finalAmount / amount : 0;
  return { amount: finalAmount, rate: combinedRate, from, to };
}
