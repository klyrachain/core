/**
 * Public Quote API — source of truth for pricing.
 * Fetches raw provider rates, gathers system state (inventory, volatility), runs PricingEngine, returns structured quote.
 */

import { randomUUID } from "node:crypto";
import { getOnrampQuote } from "./onramp-quote.service.js";
import { getBestQuotes } from "./swap-quote.service.js";
import {
  convertAmountViaUsdRates,
  getCachedUsdConversionRates,
  isExchangeRateConfigured,
} from "./exchange-rate.service.js";
import {
  isKnownFiatCurrencyCode,
  isFiatSupportedByFonbnkInDb,
  QUOTE_PIVOT_COUNTRY,
  QUOTE_PIVOT_FIAT,
  resolveCountryCodeForFiatCurrency,
} from "./quote-fiat-corridor.service.js";
import {
  getCachedChains,
  getCachedCostBasis,
  getCachedTokens,
  ensureValidationCache,
  type CachedChain,
} from "./validation-cache.service.js";
import { quoteOnRamp, quoteOffRamp, calculateBaseProfit, volatilityToPremium } from "../lib/pricing-engine.js";
import { getSwapQuoteEstimateFromAddress } from "../lib/swap-quote-from-address.js";
import { getProviderFeeCapability } from "./provider-capabilities.service.js";

export type QuoteAction = "ONRAMP" | "OFFRAMP" | "SWAP";

/** "from" = amount is the paying side (fiat for onramp, crypto for offramp). "to" = amount is the receiving side. */
export type InputSide = "from" | "to";

export type QuoteRequestDto = {
  action: QuoteAction;
  inputAmount: string;
  inputCurrency: string;
  outputCurrency: string;
  chain?: string;
  /**
   * Which side `inputAmount` refers to. Default "from".
   * ONRAMP "to": amount = **crypto to receive**; use `inputCurrency` = crypto, `outputCurrency` = fiat (or swap order — we normalize).
   * OFFRAMP "to": amount = **fiat to receive**; use `inputCurrency` = fiat, `outputCurrency` = crypto (or swap order — we normalize).
   */
  inputSide?: InputSide;
  /**
   * EVM address for swap legs inside getOnrampQuote (indirect tokens) and LiFi/Squid.
   * When omitted, Core uses QUOTE_ESTIMATE_FROM_ADDRESS (if configured) else a server estimate address.
   */
  fromAddress?: string;
};

export type QuoteResponseDto = {
  quoteId: string;
  expiresAt: string;
  /**
   * ONRAMP/OFFRAMP: **fiat per 1 unit of crypto** (e.g. GHS per USDC). For ONRAMP inputSide "from":
   * `crypto_received = fiat_paid / exchangeRate` (matches pricing engine selling price).
   */
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
  feeCapture?: {
    providerCode: string;
    supportsMarkup: boolean;
    requiresExplicitFeeLeg: boolean;
    mode: "embedded_markup" | "explicit_service_fee_leg";
    explicitServiceFee: string;
    embeddedPlatformFee: string;
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

const QUOTE_VALIDITY_SECONDS = 30;
const DEFAULT_VOLATILITY = 0.01;

/** EIP-55 / 0x + 40 hex: treat as token address. */
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/** Uppercase symbols; preserve EVM addresses as lowercase 0x… (avoid 0X breaking regex / DB match). */
export function normalizeQuoteAssetForRequest(raw: string): string {
  const t = raw.trim();
  if (ADDRESS_REGEX.test(t)) return t.toLowerCase();
  return t.toUpperCase();
}

function normalizeQuoteAssetField(raw: string): string {
  return normalizeQuoteAssetForRequest(raw);
}

function isFiatCurrencyCode(code: string): boolean {
  return isKnownFiatCurrencyCode(code);
}

function isFiatCurrencyField(raw: string): boolean {
  return isFiatCurrencyCode(raw);
}

/**
 * When inputSide is "to", the amount is always the **receive** asset.
 * Clients often send fiat/crypto fields reversed; fix so canonical ONRAMP/OFFRAMP match Fonbnk + our math.
 */
function normalizeQuoteRequestCurrencies(
  action: QuoteAction,
  inputCurrency: string,
  outputCurrency: string,
  inputSide: InputSide
): { inputCurrency: string; outputCurrency: string } {
  let ic = normalizeQuoteAssetField(inputCurrency);
  let oc = normalizeQuoteAssetField(outputCurrency);
  if (inputSide !== "to") return { inputCurrency: ic, outputCurrency: oc };

  if (action === "ONRAMP") {
    if (isFiatCurrencyField(ic) && !isFiatCurrencyField(oc)) {
      return { inputCurrency: oc, outputCurrency: ic };
    }
  }
  if (action === "OFFRAMP") {
    if (!isFiatCurrencyField(ic) && isFiatCurrencyField(oc)) {
      return { inputCurrency: oc, outputCurrency: ic };
    }
  }
  return { inputCurrency: ic, outputCurrency: oc };
}

/**
 * Resolve chain from validation cache; BNB Smart Chain may be stored as code BNB or BSC (chainId 56).
 */
function resolveCachedChain(
  chains: CachedChain[] | null | undefined,
  chainCode: string | undefined
): CachedChain | null {
  if (!chainCode?.trim() || !chains?.length) return null;
  const upper = chainCode.trim().toUpperCase();
  const direct = chains.find((c) => c.code === upper) ?? null;
  if (direct) return direct;
  if (upper === "BNB" || upper === "BSC") {
    const byId = chains.find((c) => c.chainId === 56);
    if (byId) return byId;
    return chains.find((c) => c.code === "BSC" || c.code === "BNB") ?? null;
  }
  return null;
}

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

type RawRateFailure = { ok: false; error: string; status?: number; code?: string };

/**
 * Fonbnk buy 1 unit crypto in pivot fiat (GHS), then convert to user fiat using cached bulk `latest/USD` rates (one API call per TTL).
 * Pricing engine applies margin once on the resulting fiat-per-crypto base price.
 */
async function getPivotedOnrampBasePrice(params: {
  chainId: number;
  token: string;
  swapFrom: string;
  userFiat: string;
}): Promise<{ ok: true; basePrice: number } | RawRateFailure> {
  const ghsQuote = await getOnrampQuote({
    country: QUOTE_PIVOT_COUNTRY,
    chain_id: params.chainId,
    token: params.token,
    amount: 1,
    amount_in: "crypto",
    purchase_method: "buy",
    from_address: params.swapFrom,
  });
  if (!ghsQuote.ok) {
    return { ok: false, error: ghsQuote.error, status: ghsQuote.status ?? 502 };
  }
  const ghsPerCrypto = ghsQuote.data.total_fiat;
  if (!Number.isFinite(ghsPerCrypto) || ghsPerCrypto <= 0) {
    return { ok: false, error: "Invalid pivot onramp rate", status: 502 };
  }
  const target = params.userFiat.trim().toUpperCase();
  if (target === QUOTE_PIVOT_FIAT) {
    return { ok: true, basePrice: ghsPerCrypto };
  }
  try {
    const { rates } = await getCachedUsdConversionRates();
    const amt = convertAmountViaUsdRates(QUOTE_PIVOT_FIAT, target, ghsPerCrypto, rates);
    if (!Number.isFinite(amt) || amt <= 0) {
      return {
        ok: false,
        error: "Fiat pivot returned invalid amount.",
        status: 503,
        code: "FIAT_PIVOT_UNAVAILABLE",
      };
    }
    return { ok: true, basePrice: amt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Missing or invalid USD conversion rate")) {
      return {
        ok: false,
        error: `Currency not in ExchangeRate feed or unsupported for pivot: ${target}`,
        status: 503,
        code: "FIAT_PIVOT_UNAVAILABLE",
      };
    }
    return {
      ok: false,
      error: "Fiat pivot failed (ExchangeRate API).",
      status: 503,
      code: "FIAT_PIVOT_UNAVAILABLE",
    };
  }
}

async function getPivotedOfframpBasePrice(params: {
  chainId: number;
  token: string;
  swapFrom: string;
  userFiat: string;
}): Promise<{ ok: true; basePrice: number } | RawRateFailure> {
  const ghsQuote = await getOnrampQuote({
    country: QUOTE_PIVOT_COUNTRY,
    chain_id: params.chainId,
    token: params.token,
    amount: 1,
    amount_in: "crypto",
    purchase_method: "sell",
    from_address: params.swapFrom,
  });
  if (!ghsQuote.ok) {
    return { ok: false, error: ghsQuote.error, status: ghsQuote.status ?? 502 };
  }
  const ghsPerCrypto = ghsQuote.data.total_fiat;
  if (!Number.isFinite(ghsPerCrypto) || ghsPerCrypto <= 0) {
    return { ok: false, error: "Invalid pivot offramp rate", status: 502 };
  }
  const target = params.userFiat.trim().toUpperCase();
  if (target === QUOTE_PIVOT_FIAT) {
    return { ok: true, basePrice: ghsPerCrypto };
  }
  try {
    const { rates } = await getCachedUsdConversionRates();
    const amt = convertAmountViaUsdRates(QUOTE_PIVOT_FIAT, target, ghsPerCrypto, rates);
    if (!Number.isFinite(amt) || amt <= 0) {
      return {
        ok: false,
        error: "Fiat pivot returned invalid amount.",
        status: 503,
        code: "FIAT_PIVOT_UNAVAILABLE",
      };
    }
    return { ok: true, basePrice: amt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Missing or invalid USD conversion rate")) {
      return {
        ok: false,
        error: `Currency not in ExchangeRate feed or unsupported for pivot: ${target}`,
        status: 503,
        code: "FIAT_PIVOT_UNAVAILABLE",
      };
    }
    return {
      ok: false,
      error: "Fiat pivot failed (ExchangeRate API).",
      status: 503,
      code: "FIAT_PIVOT_UNAVAILABLE",
    };
  }
}

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
  /** Passed to getOnrampQuote swap legs; defaults to server estimate address. */
  fromAddress?: string;
}): Promise<
  | { basePrice: number; providerCode: string; ok: true }
  | RawRateFailure
> {
  const { action, inputCurrency, outputCurrency, chain, fromAmountHuman, fromAddress } = params;
  const swapFrom = fromAddress?.trim() || getSwapQuoteEstimateFromAddress();
  await ensureValidationCache();
  const chains = await getCachedChains();
  const chainRecord = resolveCachedChain(chains, chain);

  if (action === "ONRAMP") {
    if (!chainRecord) return { ok: false, error: "chain is required for ONRAMP", status: 400 };
    const fiat = inputCurrency.trim().toUpperCase();
    const fonbnkCorridor = await isFiatSupportedByFonbnkInDb(fiat);
    const country = await resolveCountryCodeForFiatCurrency(inputCurrency);
    let lastDirectError = "Quote unavailable";
    let lastDirectStatus = 502;

    // USD: never use direct Fonbnk for pricing — GH corridor returns amounts in GHS; pivot GHS→USD instead.
    if (fonbnkCorridor && fiat !== "USD") {
      const result = await getOnrampQuote({
        country,
        chain_id: chainRecord.chainId,
        token: outputCurrency,
        amount: 1,
        amount_in: "crypto",
        purchase_method: "buy",
        from_address: swapFrom,
      });
      if (result.ok) {
        const basePrice = result.data.total_fiat;
        if (Number.isFinite(basePrice) && basePrice > 0) {
          return { basePrice, providerCode: "fonbnk", ok: true };
        }
        lastDirectError = "Invalid onramp rate";
      } else {
        lastDirectError = result.error;
        lastDirectStatus = result.status ?? 502;
      }
    }

    if (!isExchangeRateConfigured()) {
      const triedDirect = fonbnkCorridor && fiat !== "USD";
      return {
        ok: false,
        error: triedDirect
          ? lastDirectError
          : "Fiat pivot unavailable: set EXCHANGERATE_API_KEY for quotes in this currency.",
        status: triedDirect ? lastDirectStatus : 503,
        code: triedDirect ? undefined : "FIAT_PIVOT_UNAVAILABLE",
      };
    }

    const pivoted = await getPivotedOnrampBasePrice({
      chainId: chainRecord.chainId,
      token: outputCurrency,
      swapFrom,
      userFiat: fiat,
    });
    if (!pivoted.ok) return pivoted;
    return { basePrice: pivoted.basePrice, providerCode: "fonbnk_fx_pivot", ok: true };
  }

  if (action === "OFFRAMP") {
    if (!chainRecord) return { ok: false, error: "chain is required for OFFRAMP", status: 400 };
    const fiat = outputCurrency.trim().toUpperCase();
    const fonbnkCorridor = await isFiatSupportedByFonbnkInDb(fiat);
    const country = await resolveCountryCodeForFiatCurrency(outputCurrency);
    let lastDirectError = "Quote unavailable";
    let lastDirectStatus = 502;

    if (fonbnkCorridor && fiat !== "USD") {
      const result = await getOnrampQuote({
        country,
        chain_id: chainRecord.chainId,
        token: inputCurrency,
        amount: 1,
        amount_in: "crypto",
        purchase_method: "sell",
        from_address: swapFrom,
      });
      if (result.ok) {
        const basePrice = result.data.total_fiat;
        if (Number.isFinite(basePrice) && basePrice > 0) {
          return { basePrice, providerCode: "fonbnk", ok: true };
        }
        lastDirectError = "Invalid offramp rate";
      } else {
        lastDirectError = result.error;
        lastDirectStatus = result.status ?? 502;
      }
    }

    if (!isExchangeRateConfigured()) {
      const triedDirect = fonbnkCorridor && fiat !== "USD";
      return {
        ok: false,
        error: triedDirect
          ? lastDirectError
          : "Fiat pivot unavailable: set EXCHANGERATE_API_KEY for quotes in this currency.",
        status: triedDirect ? lastDirectStatus : 503,
        code: triedDirect ? undefined : "FIAT_PIVOT_UNAVAILABLE",
      };
    }

    const pivoted = await getPivotedOfframpBasePrice({
      chainId: chainRecord.chainId,
      token: inputCurrency,
      swapFrom,
      userFiat: fiat,
    });
    if (!pivoted.ok) return pivoted;
    return { basePrice: pivoted.basePrice, providerCode: "fonbnk_fx_pivot", ok: true };
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
      from_address: swapFrom,
      amount: amountWei,
    });
    if (!bestResult.ok) return { ok: false, error: bestResult.error, status: 502 };
    const quote = bestResult.data.best;
    const toDecimals = toTokenRecord.decimals;
    const toAmountHuman = Number(quote.to_amount) / 10 ** toDecimals;
    if (!Number.isFinite(toAmountHuman) || toAmountHuman <= 0) return { ok: false, error: "Invalid swap rate" };
    const ratePerOne = toAmountHuman / fromAmount;
    return { basePrice: ratePerOne, providerCode: quote.provider ?? "unknown", ok: true };
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
  const { action, inputAmount, chain, inputSide: inputSideRaw, fromAddress } = request;
  const inputSide: InputSide = inputSideRaw === "to" ? "to" : "from";
  const rateFromAddress = fromAddress?.trim();
  const { inputCurrency, outputCurrency } = normalizeQuoteRequestCurrencies(
    action,
    request.inputCurrency,
    request.outputCurrency,
    inputSide
  );
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

  let raw:
    | { basePrice: number; providerCode: string; ok: true }
    | { ok: false; error: string; status?: number; code?: string };
  if (action === "SWAP" && inputSide === "to") {
    const rawOne = await getRawRate({
      action,
      inputCurrency: fromCurrency,
      outputCurrency: toCurrency,
      chain,
      fromAmountHuman: 1,
      fromAddress: rateFromAddress,
    });
    if (!rawOne.ok) return { success: false, error: rawOne.error, code: "RATE_UNAVAILABLE", status: rawOne.status ?? 502 };
    const fromAmountForQuote = inputAmountNum / rawOne.basePrice;
    raw = await getRawRate({
      action,
      inputCurrency: fromCurrency,
      outputCurrency: toCurrency,
      chain,
      fromAmountHuman: fromAmountForQuote,
      fromAddress: rateFromAddress,
    });
  } else if (action === "SWAP" && inputSide === "from") {
    raw = await getRawRate({
      action,
      inputCurrency: fromCurrency,
      outputCurrency: toCurrency,
      chain,
      fromAmountHuman: inputAmountNum,
      fromAddress: rateFromAddress,
    });
  } else {
    raw = await getRawRate({
      action,
      inputCurrency: fromCurrency,
      outputCurrency: toCurrency,
      chain,
      fromAddress: rateFromAddress,
    });
  }
  if (!raw.ok) {
    const code =
      raw.code ??
      (raw.error.includes("chain is required") || raw.error.includes("CHAIN_REQUIRED")
        ? "CHAIN_REQUIRED"
        : "RATE_UNAVAILABLE");
    return { success: false, error: raw.error, code, status: raw.status ?? 502 };
  }

  const basePrice = raw.basePrice;
  const providerCode =
    "providerCode" in raw && typeof raw.providerCode === "string"
      ? raw.providerCode
      : "unknown";
  const feeCapability = getProviderFeeCapability(providerCode);

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
  const embeddedPlatformFeeNum = feeCapability.supportsMarkup ? platformFeeRounded : 0;
  const explicitServiceFeeNum = feeCapability.requiresExplicitFeeLeg ? platformFeeRounded : 0;
  const platformFeeDisplay = platformFeeRounded.toFixed(2);
  const totalFeeNum =
    embeddedPlatformFeeNum + explicitServiceFeeNum + parseFloat(networkFeeStub);
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
    feeCapture: {
      providerCode: feeCapability.providerCode,
      supportsMarkup: feeCapability.supportsMarkup,
      requiresExplicitFeeLeg: feeCapability.requiresExplicitFeeLeg,
      mode: feeCapability.supportsMarkup
        ? "embedded_markup"
        : "explicit_service_fee_leg",
      explicitServiceFee: explicitServiceFeeNum.toFixed(2),
      embeddedPlatformFee: embeddedPlatformFeeNum.toFixed(2),
    },
    ...(debug ? { debug } : {}),
  };

  return { success: true, data };
}
