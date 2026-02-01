/**
 * Public Quote API — source of truth for pricing.
 * Fetches raw provider rates, gathers system state (inventory, volatility), runs PricingEngine, returns structured quote.
 */

import { randomUUID } from "node:crypto";
import { getOnrampQuote } from "./onramp-quote.service.js";
import { getSwapQuote } from "./swap-quote.service.js";
import { getCachedChains, getCachedCostBasis, getCachedPlatformFee, getCachedProviders, getCachedTokens, ensureValidationCache } from "./validation-cache.service.js";
import { quoteOnRamp, quoteOffRamp, effectiveBaseProfit, volatilityToPremium } from "../lib/pricing-engine.js";
import { getFeeForOrder } from "./fee.service.js";

export type QuoteAction = "ONRAMP" | "OFFRAMP" | "SWAP";

export type QuoteRequestDto = {
  action: QuoteAction;
  inputAmount: string;
  inputCurrency: string;
  outputCurrency: string;
  chain?: string;
};

export type QuoteResponseDto = {
  quoteId: string;
  expiresAt: string;
  exchangeRate: string;
  input: { amount: string; currency: string };
  output: { amount: string; currency: string; chain?: string };
  fees: {
    networkFee: string;
    platformFee: string;
    totalFee: string;
  };
  debug?: {
    basePrice: string;
    profitMarginPct: string;
    volatilityPremium: string;
    inventoryRisk: string;
  };
};

/** Fiat currency → country code (for Fonbnk). */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
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

const QUOTE_VALIDITY_SECONDS = 30;
const DEFAULT_VOLATILITY = 0.01;

export type PublicQuoteResult =
  | { success: true; data: QuoteResponseDto }
  | { success: false; error: string; code?: string; status?: number };

/**
 * Get raw provider rate (cost price) for the pair.
 * ONRAMP: fiat → crypto, rate = fiat per 1 unit of crypto (e.g. GHS per USDC).
 * OFFRAMP: crypto → fiat, rate = fiat per 1 unit of crypto (provider sell).
 * SWAP: crypto → crypto, rate = output amount per 1 unit input (human).
 */
async function getRawRate(params: {
  action: QuoteAction;
  inputCurrency: string;
  outputCurrency: string;
  chain?: string;
}): Promise<{ basePrice: number; ok: true } | { ok: false; error: string; status?: number }> {
  const { action, inputCurrency, outputCurrency, chain } = params;
  await ensureValidationCache();
  const chains = await getCachedChains();
  const chainRecord = chain ? chains?.find((c) => c.code === chain.trim().toUpperCase()) : null;

  if (action === "ONRAMP") {
    if (!chainRecord) return { ok: false, error: "chain is required for ONRAMP", status: 400 };
    const country = CURRENCY_TO_COUNTRY[inputCurrency.toUpperCase()] ?? "GH";
    const result = await getOnrampQuote({
      country,
      chain_id: chainRecord.chainId,
      token: outputCurrency,
      amount: 1,
      amount_in: "crypto",
      purchase_method: "buy",
    });
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    const basePrice = result.data.total_fiat;
    if (!Number.isFinite(basePrice) || basePrice <= 0) return { ok: false, error: "Invalid onramp rate" };
    return { basePrice, ok: true };
  }

  if (action === "OFFRAMP") {
    if (!chainRecord) return { ok: false, error: "chain is required for OFFRAMP", status: 400 };
    const country = CURRENCY_TO_COUNTRY[outputCurrency.toUpperCase()] ?? "GH";
    const result = await getOnrampQuote({
      country,
      chain_id: chainRecord.chainId,
      token: inputCurrency,
      amount: 1,
      amount_in: "crypto",
      purchase_method: "sell",
    });
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    const basePrice = result.data.total_fiat;
    if (!Number.isFinite(basePrice) || basePrice <= 0) return { ok: false, error: "Invalid offramp rate" };
    return { basePrice, ok: true };
  }

  if (action === "SWAP") {
    if (!chainRecord) return { ok: false, error: "chain is required for SWAP", status: 400 };
    const tokensList = await getCachedTokens();
    if (!tokensList) return { ok: false, error: "Token list not available" };
    const fromTokenRecord = tokensList.find(
      (t) => t.chainId === chainRecord.chainId && t.symbol.toUpperCase() === inputCurrency.toUpperCase()
    );
    const toTokenRecord = tokensList.find(
      (t) => t.chainId === chainRecord.chainId && t.symbol.toUpperCase() === outputCurrency.toUpperCase()
    );
    if (!fromTokenRecord || !toTokenRecord) return { ok: false, error: "Unsupported token pair for SWAP", status: 400 };
    const decimals = fromTokenRecord.decimals ?? 18;
    const amountWei = String(Math.round(Number(1) * 10 ** decimals));
    const swapResult = await getSwapQuote({
      provider: "0x",
      from_chain: chainRecord.chainId,
      to_chain: chainRecord.chainId,
      from_token: fromTokenRecord.tokenAddress,
      to_token: toTokenRecord.tokenAddress,
      amount: amountWei,
    });
    if (!swapResult.ok) return { ok: false, error: swapResult.error, status: swapResult.status };
    const toDecimals = toTokenRecord.decimals ?? 18;
    const toAmountHuman = Number(swapResult.quote.to_amount) / 10 ** toDecimals;
    if (!Number.isFinite(toAmountHuman) || toAmountHuman <= 0) return { ok: false, error: "Invalid swap rate" };
    return { basePrice: toAmountHuman, ok: true };
  }

  return { ok: false, error: "Unsupported action", status: 400 };
}

/**
 * Build public quote: raw rate → system state → pricing engine → response.
 */
export async function buildPublicQuote(
  request: QuoteRequestDto,
  options?: { includeDebug?: boolean }
): Promise<PublicQuoteResult> {
  const { action, inputAmount, inputCurrency, outputCurrency, chain } = request;
  const inputAmountNum = parseFloat(inputAmount);
  if (!Number.isFinite(inputAmountNum) || inputAmountNum <= 0) {
    return { success: false, error: "inputAmount must be a positive number", code: "INVALID_INPUT_AMOUNT", status: 400 };
  }

  if (action === "ONRAMP" || action === "OFFRAMP") {
    if (!chain?.trim()) {
      return { success: false, error: "chain is required for ONRAMP and OFFRAMP", code: "CHAIN_REQUIRED", status: 400 };
    }
  }

  const raw = await getRawRate({ action, inputCurrency, outputCurrency, chain });
  if (!raw.ok) return { success: false, error: raw.error, code: "RATE_UNAVAILABLE", status: raw.status ?? 502 };

  const basePrice = raw.basePrice;

  await ensureValidationCache();
  const platformFee = await getCachedPlatformFee();
  const baseFeePercent = platformFee?.baseFeePercent ?? 1;
  const providers = await getCachedProviders();
  const providerFee = providers?.find((p) => p.code === "KLYRA" || p.code === "PAYSTACK")?.fee ?? 0.005;
  const baseProfit = effectiveBaseProfit(baseFeePercent, providerFee);
  const volatility = DEFAULT_VOLATILITY;

  let exchangeRate: number;
  let debug: QuoteResponseDto["debug"] | undefined;

  if (action === "ONRAMP") {
    const costBasis = await getCachedCostBasis(chain!, outputCurrency);
    const avgBuyPrice = costBasis ?? basePrice;
    const result = quoteOnRamp({
      providerPrice: basePrice,
      avgBuyPrice,
      minSellingPrice: avgBuyPrice,
      baseProfit,
      volatility,
    });
    exchangeRate = result.pricePerToken;
    if (options?.includeDebug) {
      debug = {
        basePrice: basePrice.toFixed(2),
        profitMarginPct: `${((result.totalPremium ?? 0) * 100).toFixed(2)}%`,
        volatilityPremium: volatilityToPremium(volatility).toFixed(4),
        inventoryRisk: (result.atFloor ? "floor" : "0").toString(),
      };
    }
  } else if (action === "OFFRAMP") {
    const result = quoteOffRamp({
      providerPrice: basePrice,
      baseProfit,
      volatility,
      maxBuyPrice: basePrice,
    });
    exchangeRate = result.pricePerToken;
    if (options?.includeDebug) {
      debug = {
        basePrice: basePrice.toFixed(2),
        profitMarginPct: `${((result.totalDiscount ?? 0) * 100).toFixed(2)}%`,
        volatilityPremium: volatilityToPremium(volatility).toFixed(4),
        inventoryRisk: "0",
      };
    }
  } else {
    exchangeRate = basePrice;
    if (options?.includeDebug) {
      debug = {
        basePrice: basePrice.toFixed(6),
        profitMarginPct: "0%",
        volatilityPremium: "0",
        inventoryRisk: "0",
      };
    }
  }

  let outputAmount: number;
  if (action === "ONRAMP") {
    outputAmount = inputAmountNum / exchangeRate;
  } else if (action === "OFFRAMP") {
    outputAmount = inputAmountNum * exchangeRate;
  } else {
    outputAmount = inputAmountNum * exchangeRate;
  }

  const feeQuote = getFeeForOrder({
    action: action === "ONRAMP" ? "buy" : action === "OFFRAMP" ? "sell" : "buy",
    f_amount: action === "ONRAMP" ? inputAmountNum : inputAmountNum,
    t_amount: action === "ONRAMP" ? outputAmount : outputAmount,
    f_price: action === "ONRAMP" ? 1 : exchangeRate,
    t_price: action === "ONRAMP" ? exchangeRate : 1,
    f_chain: action === "ONRAMP" ? (chain ?? "") : chain ?? "",
    t_chain: action === "ONRAMP" ? (chain ?? "") : "",
    f_token: action === "ONRAMP" ? inputCurrency : inputCurrency,
    t_token: action === "ONRAMP" ? outputCurrency : outputCurrency,
  });

  const networkFeeStub = "0";
  const platformFeeDisplay = feeQuote.feeAmount.toFixed(2);
  const totalFeeNum = feeQuote.feeAmount + parseFloat(networkFeeStub);
  const expiresAt = new Date(Date.now() + QUOTE_VALIDITY_SECONDS * 1000).toISOString();

  const data: QuoteResponseDto = {
    quoteId: randomUUID(),
    expiresAt,
    exchangeRate: exchangeRate.toFixed(2),
    input: { amount: inputAmount.trim(), currency: inputCurrency },
    output: {
      amount: outputAmount.toFixed(2),
      currency: outputCurrency,
      ...(chain ? { chain } : {}),
    },
    fees: {
      networkFee: networkFeeStub,
      platformFee: platformFeeDisplay,
      totalFee: totalFeeNum.toFixed(2),
    },
    ...(debug ? { debug } : {}),
  };

  return { success: true, data };
}
