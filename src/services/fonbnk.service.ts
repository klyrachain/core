/**
 * Fonbnk API: fiat↔crypto quotes for onramp.
 * Docs: https://docs.fonbnk.com/
 * Payout/deposit currency must be NETWORK_ASSET (chain + token, e.g. BASE_USDC, POLYGON_USDC, ETHEREUM_NATIVE).
 * Supported list: https://docs.fonbnk.com/supported-countries-and-cryptocurrencies
 */

import crypto from "node:crypto";
import { getEnv } from "../config/env.js";
import type { FonbnkQuoteRequest, FonbnkQuoteResponse } from "../lib/onramp-quote.types.js";

/** Fonbnk-supported payout/deposit codes (NETWORK_ASSET). From https://docs.fonbnk.com/supported-countries-and-cryptocurrencies */
const FONBNK_SUPPORTED_PAYOUT_CODES = new Set([
  "ARBITRUM_USDC",
  "ARBITRUM_USDT",
  "AVALANCHE_USDC",
  "AVALANCHE_USDT",
  "BASE_USDC",
  "BNB_USDC",
  "BNB_USDT",
  "CELO_CGHS",
  "CELO_CKES",
  "CELO_CUSD",
  "CELO_USDC",
  "CELO_USDT",
  "ETHEREUM_NATIVE",
  "ETHEREUM_RLUSD",
  "ETHEREUM_USDC",
  "ETHEREUM_USDT",
  "LISK_USDT",
  "OPTIMISM_USDC",
  "OPTIMISM_USDT",
  "POLYGON_USDC",
  "POLYGON_USDT",
  "SOLANA_NATIVE",
  "SOLANA_USDC",
  "SOLANA_USDT",
  "STELLAR_USDC",
  "TON_USDE",
  "TON_USDT",
  "TRON_NATIVE",
  "TRON_USDT",
  "XRP_RLUSD",
]);

export function isFonbnkSupportedPayoutCode(code: string): boolean {
  const normalized = code.trim().toUpperCase();
  return FONBNK_SUPPORTED_PAYOUT_CODES.has(normalized);
}

/**
 * When SupportedToken.fonbnkCode is null, infer Fonbnk NETWORK_ASSET from chain + symbol.
 * Never use `${chainId}_${symbol}` for API calls — numeric prefixes are invalid for Fonbnk.
 */
const CHAIN_ID_SYMBOL_TO_FONBNK: Record<string, string> = {
  "8453:USDC": "BASE_USDC",
  "8453:ETH": "BASE_ETH",
  "56:USDC": "BNB_USDC",
  "56:USDT": "BNB_USDT",
  "56:BNB": "BNB_NATIVE",
  "1:USDC": "ETHEREUM_USDC",
  "1:USDT": "ETHEREUM_USDT",
  "1:ETH": "ETHEREUM_NATIVE",
  "101:SOL": "SOLANA_NATIVE",
  "101:USDC": "SOLANA_USDC",
  "101:USDT": "SOLANA_USDT",
  "42161:USDC": "ARBITRUM_USDC",
  "42161:USDT": "ARBITRUM_USDT",
  "43114:USDC": "AVALANCHE_USDC",
  "43114:USDT": "AVALANCHE_USDT",
  "10:USDC": "OPTIMISM_USDC",
  "10:USDT": "OPTIMISM_USDT",
  "137:USDC": "POLYGON_USDC",
  "137:USDT": "POLYGON_USDT",
};

export function inferFonbnkCodeFromChainAndSymbol(chainId: number, symbol: string): string | null {
  const key = `${chainId}:${symbol.trim().toUpperCase()}`;
  const code = CHAIN_ID_SYMBOL_TO_FONBNK[key];
  if (!code) return null;
  return isFonbnkSupportedPayoutCode(code) ? code : null;
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  GH: "GHS",
  NG: "NGN",
  KE: "KES",
  TZ: "TZS",
  UG: "UGX",
  RW: "RWF",
  ZM: "ZMW",
  ZA: "ZAR",
  CI: "XOF",
  SN: "XOF",
  BJ: "XOF",
  TG: "XOF",
  CM: "XAF",
  BW: "BWP",
  MZ: "MZN",
};

function getConfig(): {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeout: number;
} {
  const env = getEnv();
  const baseUrl =
    (env.FONBNK_API_URL && env.FONBNK_API_URL.trim()) || "https://api.fonbnk.com";
  const clientId = env.FONBNK_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.FONBNK_CLIENT_SECRET?.trim() ?? "";
  const timeout = env.FONBNK_TIMEOUT_MS ?? 10000;
  return { baseUrl, clientId, clientSecret, timeout };
}

function signRequest(endpoint: string, timestamp: string, clientSecret: string): string {
  const padBase64 = (str: string): string =>
    str + "=".repeat((4 - (str.length % 4)) % 4);
  const decodedSecret = Buffer.from(padBase64(clientSecret), "base64");
  const message = `${timestamp}:${endpoint}`;
  const hmac = crypto.createHmac("sha256", decodedSecret);
  hmac.update(message, "utf8");
  return hmac.digest("base64");
}

/**
 * Normalize token to Fonbnk payout currency code.
 * Fonbnk requires NETWORK_ASSET (e.g. BASE_USDC, ETHEREUM_USDC). Never invent a network from a bare symbol.
 */
export function toPayoutCurrencyCode(token: string): string {
  const normalized = token.trim().toUpperCase();
  if (!normalized.includes("_")) {
    throw new Error(
      `Fonbnk requires NETWORK_ASSET (e.g. ETHEREUM_USDC), not a bare symbol: ${token}`
    );
  }
  return normalized;
}

export function getCurrencyForCountry(countryCode: string): string {
  const code = countryCode.trim().toUpperCase().slice(0, 2);
  return COUNTRY_TO_CURRENCY[code] ?? "GHS";
}

export function isFonbnkConfigured(): boolean {
  const { clientId, clientSecret } = getConfig();
  return !!(clientId && clientSecret);
}

interface FonbnkCashout {
  exchangeRate?: number;
  amountAfterFees?: number;
  totalChargedFees?: number;
}

interface FonbnkQuoteApiResponse {
  deposit?: {
    cashout?: FonbnkCashout;
    currencyCode?: string;
    currencyDetails?: { network?: string; asset?: string };
  };
  payout?: {
    cashout?: FonbnkCashout;
    currencyCode?: string;
    currencyDetails?: { network?: string; asset?: string; countryIsoCode?: string };
  };
}

/**
 * Fetch quote from Fonbnk. Buy: fiat→crypto or "I want X crypto, how much fiat?". Sell: crypto→fiat.
 */
export async function getFonbnkQuote(
  request: FonbnkQuoteRequest
): Promise<FonbnkQuoteResponse | null> {
  const { baseUrl, clientId, clientSecret, timeout } = getConfig();
  if (!clientId || !clientSecret) {
    throw new Error("Missing FONBNK_CLIENT_ID or FONBNK_CLIENT_SECRET.");
  }

  const countryCode = request.country.trim().toUpperCase().slice(0, 2);
  const currency = getCurrencyForCountry(request.country);
  const payoutCurrencyCode = toPayoutCurrencyCode(request.token);
  const isBuy = request.purchaseMethod === "buy";
  const amountIn = request.amountIn === "crypto" ? "crypto" : "fiat";
  const defaultFiatAmount = 100;
  const defaultCryptoAmount = 1;
  const amount =
    request.amount != null && Number.isFinite(request.amount) && request.amount > 0
      ? request.amount
      : isBuy
        ? amountIn === "crypto"
          ? defaultCryptoAmount
          : defaultFiatAmount
        : defaultCryptoAmount;

  const endpoint = "/api/v2/quote";
  const timestamp = Date.now().toString();
  const signature = signRequest(endpoint, timestamp, clientSecret);

  const requestBody = isBuy
    ? amountIn === "crypto"
      ? {
        deposit: {
          paymentChannel: "mobile_money" as const,
          currencyType: "fiat" as const,
          currencyCode: currency,
          countryIsoCode: countryCode,
        },
        payout: {
          paymentChannel: "crypto" as const,
          currencyType: "crypto" as const,
          currencyCode: payoutCurrencyCode,
          amount,
        },
      }
      : {
        deposit: {
          paymentChannel: "mobile_money" as const,
          currencyType: "fiat" as const,
          currencyCode: currency,
          countryIsoCode: countryCode,
          amount,
        },
        payout: {
          paymentChannel: "crypto" as const,
          currencyType: "crypto" as const,
          currencyCode: payoutCurrencyCode,
        },
      }
    : {
      deposit: {
        paymentChannel: "crypto" as const,
        currencyType: "crypto" as const,
        currencyCode: payoutCurrencyCode,
        amount,
      },
      payout: {
        paymentChannel: "mobile_money" as const,
        currencyType: "fiat" as const,
        currencyCode: currency,
        countryIsoCode: countryCode,
      },
    };

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  const httpResponse = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-timestamp": timestamp,
      "x-signature": signature,
    },
    body: JSON.stringify(requestBody),
    signal: abortController.signal,
  });

  clearTimeout(timeoutId);

  if (!httpResponse.ok) {
    const responseText = await httpResponse.text();
    let errorMessage: string;
    try {
      const parsedError = JSON.parse(responseText) as { message?: string };
      errorMessage = parsedError.message ?? responseText;
    } catch {
      errorMessage = responseText || httpResponse.statusText;
    }
    throw new Error(`Fonbnk API error: ${errorMessage}`);
  }

  const apiResponse = (await httpResponse.json()) as FonbnkQuoteApiResponse;

  if (isBuy) {
    const depositCashout = apiResponse.deposit?.cashout;
    const payoutCashout = apiResponse.payout?.cashout;
    if (!depositCashout) return null;
    const exchangeRate = depositCashout.exchangeRate;
    if (exchangeRate == null || Number(exchangeRate) <= 0) return null;

    if (amountIn === "crypto") {
      const fiatToPay =
        depositCashout.amountAfterFees ??
        (exchangeRate != null ? amount * Number(exchangeRate) : null);
      return {
        country: countryCode,
        currency,
        network:
          apiResponse.payout?.currencyDetails?.network?.toLowerCase() ?? "base",
        asset: apiResponse.payout?.currencyDetails?.asset ?? "USDC",
        amount,
        rate: Number(exchangeRate),
        fee: Number(depositCashout.totalChargedFees ?? 0),
        total:
          fiatToPay != null ? Number(fiatToPay) : amount * Number(exchangeRate),
        paymentChannel: "mobile_money",
        purchaseMethod: "buy",
        amountIn: "crypto",
      };
    }

    const totalCryptoReceived = payoutCashout?.amountAfterFees ?? null;
    return {
      country: countryCode,
      currency,
      network:
        apiResponse.payout?.currencyDetails?.network?.toLowerCase() ?? "base",
      asset: apiResponse.payout?.currencyDetails?.asset ?? "USDC",
      amount,
      rate: Number(exchangeRate),
      fee: Number(depositCashout.totalChargedFees ?? 0),
      total:
        totalCryptoReceived != null
          ? Number(totalCryptoReceived)
          : amount / Number(exchangeRate),
      paymentChannel: "mobile_money",
      purchaseMethod: "buy",
      amountIn: "fiat",
    };
  }

  const payoutCashout = apiResponse.payout?.cashout;
  if (!payoutCashout) return null;
  const exchangeRate = payoutCashout.exchangeRate;
  if (exchangeRate == null || Number(exchangeRate) <= 0) return null;
  return {
    country: countryCode,
    currency: apiResponse.payout?.currencyCode ?? currency,
    network:
      apiResponse.deposit?.currencyDetails?.network?.toLowerCase() ?? "base",
    asset: apiResponse.deposit?.currencyDetails?.asset ?? "USDC",
    amount,
    rate: Number(exchangeRate),
    fee: Number(payoutCashout.totalChargedFees ?? 0),
    total: Number(payoutCashout.amountAfterFees ?? amount),
    paymentChannel: "mobile_money",
    purchaseMethod: "sell",
    amountIn: "crypto",
  };
}
