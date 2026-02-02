/**
 * Public Quote API — source of truth for pricing.
 * Fetches raw provider rates, gathers system state (inventory, volatility), runs PricingEngine, returns structured quote.
 */

import { randomUUID } from "node:crypto";
import { getOnrampQuote } from "./onramp-quote.service.js";
import { getBestQuotes } from "./swap-quote.service.js";
import { getCachedChains, getCachedCostBasis, getCachedTokens, ensureValidationCache } from "./validation-cache.service.js";
import { quoteOnRamp, quoteOffRamp, calculateBaseProfit, volatilityToPremium } from "../lib/pricing-engine.js";

export type QuoteAction = "ONRAMP" | "OFFRAMP" | "SWAP";

/** "from" = amount is the paying side (fiat for onramp, crypto for offramp). "to" = amount is the receiving side. */
export type InputSide = "from" | "to";

export type QuoteRequestDto = {
  action: QuoteAction;
  inputAmount: string;
  inputCurrency: string;
  outputCurrency: string;
  chain?: string;
  /** Which side the amount refers to. Default "from". "to" = e.g. "I want X crypto" (onramp) or "I want X fiat" (offramp). */
  inputSide?: InputSide;
};

export type QuoteResponseDto = {
  quoteId: string;
  expiresAt: string;
  exchangeRate: string;
  /** Provider quote (e.g. Fonbnk base price) — used for P&L and fee; always stored so order webhook can set Transaction.providerPrice from quote */
  basePrice?: string;
  /** Real prices for custom fee/profit: provider (e.g. Fonbnk), selling (exchangeRate), avgBuy (inventory cost basis, onramp only) */
  prices?: {
    providerPrice: string;
    sellingPrice: string;
    avgBuyPrice?: string;
  };
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
    /** Cost basis (avg buy price) from inventory — profit = sellingPrice - costBasis */
    costBasis?: string;
    /** Provider quote (basePrice) — fee = sellingPrice - providerPrice */
    providerPrice?: string;
    /** Price we sell to user (exchangeRate) */
    sellingPrice?: string;
    /** Per-unit fee: sellingPrice - providerPrice */
    feePerUnit?: string;
    /** Per-unit profit: sellingPrice - costBasis */
    profitPerUnit?: string;
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

/** EIP-55 / 0x + 40 hex: treat as token address. */
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type TokenRecordForSwap = { tokenAddress: string; decimals: number; symbol: string };

/**
 * Resolve inputCurrency/outputCurrency to a token record for SWAP.
 * Accepts either a symbol (must exist in supported tokens) or a token address (0x + 40 hex).
 * If address is not in the table, returns a synthetic record so the swap provider can still be called (decimals default 18).
 */
function resolveTokenForSwap(
  tokensList: { chainId: number; symbol: string; tokenAddress: string; decimals: number }[],
  chainId: number,
  symbolOrAddress: string
): TokenRecordForSwap | null {
  const trimmed = symbolOrAddress.trim();
  const isAddress = ADDRESS_REGEX.test(trimmed);
  const addrLower = isAddress ? trimmed.toLowerCase() : "";

  const bySymbol = tokensList.find(
    (t) => t.chainId === chainId && t.symbol.toUpperCase() === trimmed.toUpperCase()
  );
  if (bySymbol) return { tokenAddress: bySymbol.tokenAddress, decimals: bySymbol.decimals ?? 18, symbol: bySymbol.symbol };

  const byAddress = tokensList.find(
    (t) => t.chainId === chainId && t.tokenAddress.toLowerCase() === addrLower
  );
  if (byAddress) return { tokenAddress: byAddress.tokenAddress, decimals: byAddress.decimals ?? 18, symbol: byAddress.symbol };

  if (isAddress) {
    return { tokenAddress: trimmed, decimals: 18, symbol: trimmed };
  }
  return null;
}

export type PublicQuoteResult =
  | { success: true; data: QuoteResponseDto }
  | { success: false; error: string; code?: string; status?: number };

/**
 * Get raw provider rate (cost price) for the pair.
 * ONRAMP: fiat → crypto, rate = fiat per 1 unit of crypto (e.g. GHS per USDC).
 * OFFRAMP: crypto → fiat, rate = fiat per 1 unit of crypto (provider sell).
 * SWAP: crypto → crypto, rate = output amount per 1 unit input (human). Uses supported tokens to resolve symbols to addresses; passes fromAmountHuman as wei to provider.
 */
async function getRawRate(params: {
  action: QuoteAction;
  inputCurrency: string;
  outputCurrency: string;
  chain?: string;
  /** For SWAP only: from-token amount in human form. Converted to wei and sent to swap provider. If omitted, 1 is used (rate quote). */
  fromAmountHuman?: number;
}): Promise<{ basePrice: number; ok: true } | { ok: false; error: string; status?: number }> {
  const { action, inputCurrency, outputCurrency, chain, fromAmountHuman } = params;
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
    const fromTokenRecord = resolveTokenForSwap(tokensList, chainRecord.chainId, inputCurrency);
    const toTokenRecord = resolveTokenForSwap(tokensList, chainRecord.chainId, outputCurrency);
    if (!fromTokenRecord || !toTokenRecord) {
      const missing = [
        !fromTokenRecord ? inputCurrency : null,
        !toTokenRecord ? outputCurrency : null,
      ].filter(Boolean);

      return {
        ok: false,
        error: `Unsupported token pair for SWAP: ${missing.join(" and ")} not found for chain ${chain?.toLowerCase() ?? "?"}. Use a symbol from SupportedToken or a token address (0x + 40 hex).`,
        status: 400,
      };
    }
    const decimals = fromTokenRecord.decimals;
    const fromAmount = fromAmountHuman != null && Number.isFinite(fromAmountHuman) && fromAmountHuman > 0 ? fromAmountHuman : 1;
    const amountWei = String(Math.round(fromAmount * 10 ** decimals));
    const bestResult = await getBestQuotes({
      from_chain: chainRecord.chainId,
      to_chain: chainRecord.chainId,
      from_token: fromTokenRecord.tokenAddress,
      to_token: toTokenRecord.tokenAddress,
      from_address: "0x0000000000000000000000000000000000000001",
      amount: amountWei,
    });
    if (!bestResult.ok) return { ok: false, error: bestResult.error, status: 502 };
    const quote = bestResult.data.best;
    const toDecimals = toTokenRecord.decimals;
    const toAmountHuman = Number(quote.to_amount) / 10 ** toDecimals;
    if (!Number.isFinite(toAmountHuman) || toAmountHuman <= 0) return { ok: false, error: "Invalid swap rate" };
    const ratePerOne = toAmountHuman / fromAmount;
    return { basePrice: ratePerOne, ok: true };
  }

  return { ok: false, error: "Unsupported action", status: 400 };
}

/**
 * Canonical from/to for action: ONRAMP from=fiat to=crypto, OFFRAMP from=crypto to=fiat, SWAP from=input to=output.
 */
function getCanonicalCurrencies(
  action: QuoteAction,
  inputCurrency: string,
  outputCurrency: string,
  inputSide: InputSide
): { fromCurrency: string; toCurrency: string } {
  if (action === "SWAP") {
    return { fromCurrency: inputCurrency, toCurrency: outputCurrency };
  }
  // ONRAMP: from = fiat, to = crypto. OFFRAMP: from = crypto, to = fiat.
  if (inputSide === "from") {
    return { fromCurrency: inputCurrency, toCurrency: outputCurrency };
  }
  // inputSide "to": user sent amount in output (what they want). So from = outputCurrency, to = inputCurrency in request terms.
  return { fromCurrency: outputCurrency, toCurrency: inputCurrency };
}

/**
 * Build public quote: raw rate → system state → pricing engine → response.
 * Supports inputSide "from" (default) or "to": amount can be the paying side or the receiving side (legacy-style).
 */
export async function buildPublicQuote(
  request: QuoteRequestDto,
  options?: { includeDebug?: boolean }
): Promise<PublicQuoteResult> {
  const { action, inputAmount, inputCurrency, outputCurrency, chain, inputSide: inputSideRaw } = request;
  const inputSide: InputSide = inputSideRaw === "to" ? "to" : "from";
  const inputAmountNum = parseFloat(inputAmount);
  if (!Number.isFinite(inputAmountNum) || inputAmountNum <= 0) {
    return { success: false, error: "inputAmount must be a positive number", code: "INVALID_INPUT_AMOUNT", status: 400 };
  }

  if (action === "ONRAMP" || action === "OFFRAMP") {
    if (!chain?.trim()) {
      return { success: false, error: "chain is required for ONRAMP and OFFRAMP", code: "CHAIN_REQUIRED", status: 400 };
    }
  }

  const { fromCurrency, toCurrency } = getCanonicalCurrencies(action, inputCurrency, outputCurrency, inputSide);

  let raw: { basePrice: number; ok: true } | { ok: false; error: string; status?: number };
  if (action === "SWAP" && inputSide === "to") {
    const rawOne = await getRawRate({ action, inputCurrency: fromCurrency, outputCurrency: toCurrency, chain, fromAmountHuman: 1 });
    if (!rawOne.ok) return { success: false, error: rawOne.error, code: "RATE_UNAVAILABLE", status: rawOne.status ?? 502 };
    const fromAmountForQuote = inputAmountNum / rawOne.basePrice;
    raw = await getRawRate({ action, inputCurrency: fromCurrency, outputCurrency: toCurrency, chain, fromAmountHuman: fromAmountForQuote });
  } else if (action === "SWAP" && inputSide === "from") {
    raw = await getRawRate({ action, inputCurrency: fromCurrency, outputCurrency: toCurrency, chain, fromAmountHuman: inputAmountNum });
  } else {
    raw = await getRawRate({ action, inputCurrency: fromCurrency, outputCurrency: toCurrency, chain });
  }
  if (!raw.ok) return { success: false, error: raw.error, code: "RATE_UNAVAILABLE", status: raw.status ?? 502 };

  const basePrice = raw.basePrice;

  await ensureValidationCache();
  const volatility = DEFAULT_VOLATILITY;
  // Auto base profit (plan §7.2): inventory + velocity + volatility → [1%, 4.5%]. Use defaults until we have real inventory ratio / tradesPerHour.
  const baseProfit = calculateBaseProfit({
    inventoryRatio: 0.5,
    tradesPerHour: 0,
    volatility,
  });

  let exchangeRate: number;
  let debug: QuoteResponseDto["debug"] | undefined;
  let avgBuyPriceForPrices: number | null = null;

  if (action === "ONRAMP") {
    const costBasis = await getCachedCostBasis(chain!, toCurrency);
    const avgBuyPrice = costBasis ?? basePrice;
    avgBuyPriceForPrices = avgBuyPrice;
    const result = quoteOnRamp({
      providerPrice: basePrice,
      avgBuyPrice,
      minSellingPrice: avgBuyPrice,
      baseProfit,
      volatility,
    });
    exchangeRate = result.pricePerToken;
    if (options?.includeDebug) {
      const sellingPrice = exchangeRate;
      const feePerUnit = sellingPrice - basePrice;
      const profitPerUnit = sellingPrice - avgBuyPrice;
      debug = {
        basePrice: basePrice.toFixed(2),
        profitMarginPct: `${((result.totalPremium ?? 0) * 100).toFixed(2)}%`,
        volatilityPremium: volatilityToPremium(volatility).toFixed(4),
        inventoryRisk: (result.atFloor ? "floor" : "0").toString(),
        costBasis: avgBuyPrice.toFixed(2),
        providerPrice: basePrice.toFixed(2),
        sellingPrice: sellingPrice.toFixed(2),
        feePerUnit: feePerUnit.toFixed(4),
        profitPerUnit: profitPerUnit.toFixed(4),
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
    // SWAP: apply pricing engine — user gets slightly less output per unit input (platform margin).
    const swapMargin = calculateBaseProfit({
      inventoryRatio: 0.5,
      tradesPerHour: 0,
      volatility: DEFAULT_VOLATILITY,
    });
    exchangeRate = basePrice * (1 - swapMargin);
    if (options?.includeDebug) {
      debug = {
        basePrice: basePrice.toFixed(6),
        profitMarginPct: `${(swapMargin * 100).toFixed(2)}%`,
        volatilityPremium: volatilityToPremium(DEFAULT_VOLATILITY).toFixed(4),
        inventoryRisk: "0",
      };
    }
  }

  // From/to amounts in canonical form (from = paying side, to = receiving side).
  let fromAmount: number;
  let toAmount: number;
  if (action === "ONRAMP") {
    if (inputSide === "from") {
      fromAmount = inputAmountNum;
      toAmount = fromAmount / exchangeRate;
    } else {
      toAmount = inputAmountNum;
      fromAmount = toAmount * exchangeRate;
    }
  } else if (action === "OFFRAMP") {
    if (inputSide === "from") {
      fromAmount = inputAmountNum;
      toAmount = fromAmount * exchangeRate;
    } else {
      toAmount = inputAmountNum;
      fromAmount = toAmount / exchangeRate;
    }
  } else {
    fromAmount = inputAmountNum;
    toAmount = fromAmount * exchangeRate;
  }

  // Fee = (selling price − provider price) × quantity (spread-based for onramp/offramp)
  let platformFeeNum: number;
  if (action === "ONRAMP") {
    const feePerUnit = exchangeRate - basePrice;
    platformFeeNum = feePerUnit * toAmount;
  } else if (action === "OFFRAMP") {
    const feePerUnit = basePrice - exchangeRate;
    platformFeeNum = feePerUnit * fromAmount;
  } else {
    // SWAP: platform fee = (provider rate − our rate) × fromAmount = spread on output we keep.
    const providerOutput = fromAmount * basePrice;
    platformFeeNum = Math.max(0, providerOutput - fromAmount * exchangeRate);
  }

  const networkFeeStub = "0";
  const platformFeeRounded = Math.round(platformFeeNum * 1e8) / 1e8;
  const platformFeeDisplay = platformFeeRounded.toFixed(2);
  const totalFeeNum = platformFeeRounded + parseFloat(networkFeeStub);
  const expiresAt = new Date(Date.now() + QUOTE_VALIDITY_SECONDS * 1000).toISOString();

  const prices = {
    providerPrice: basePrice.toFixed(2),
    sellingPrice: exchangeRate.toFixed(2),
    ...(avgBuyPriceForPrices != null ? { avgBuyPrice: avgBuyPriceForPrices.toFixed(2) } : {}),
  };

  const data: QuoteResponseDto = {
    quoteId: randomUUID(),
    expiresAt,
    exchangeRate: exchangeRate.toFixed(2),
    basePrice: basePrice.toFixed(2),
    prices,
    input: { amount: fromAmount.toFixed(2), currency: fromCurrency },
    output: {
      amount: toAmount.toFixed(2),
      currency: toCurrency,
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
