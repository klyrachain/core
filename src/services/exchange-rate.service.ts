/**
 * Fiat-to-fiat exchange rates (e.g. ExchangeRate-API).
 * Use USD as pivot for conversions to Fonbnk currencies (GHS, NGN, etc.).
 * https://www.exchangerate-api.com/
 */

import { getEnv } from "../config/env.js";
import type { FiatQuoteRequest, FiatQuoteResponse } from "../lib/rates.types.js";

const BASE_URL = "https://v6.exchangerate-api.com/v6";

function getApiKey(): string {
  const key = getEnv().EXCHANGERATE_API_KEY?.trim() ?? "";
  if (!key) {
    throw new Error("Missing EXCHANGERATE_API_KEY. Set it for fiat conversion.");
  }
  return key;
}

export function isExchangeRateConfigured(): boolean {
  try {
    const key = getEnv().EXCHANGERATE_API_KEY?.trim();
    return !!key;
  } catch {
    return false;
  }
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
 * Use when direct pair may be less accurate or for consistency with Fonbnk (USD-based).
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
