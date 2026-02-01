/**
 * Merchant Pricing Engine — pure TS, no I/O.
 * On-ramp: sell crypto at price above provider buy, floor at cost basis.
 * Off-ramp: buy crypto at price below provider sell, cap at provider sell.
 * Currency/token: all prices are per-token in same unit; conversion is correct before adding fee.
 */

const TOTAL_PREMIUM_CAP = 0.06;
const TOTAL_DISCOUNT_CAP = 0.06;

/** Volatility → premium (quote). Used in both on-ramp and off-ramp. */
export function volatilityToPremium(volatility: number): number {
  const v = volatility < 0 ? 0 : volatility;
  if (v < 0.005) return 0;
  if (v < 0.015) return 0.005;
  if (v < 0.03) return 0.015;
  return 0.03;
}

export type QuoteOnRampInput = {
  providerPrice: number; // provider buy price (we buy from provider)
  avgBuyPrice?: number;  // cost basis (floor)
  baseProfit: number;   // decimal e.g. 0.01 = 1%
  volatility: number;
  minSellingPrice?: number;
};

export type QuoteOnRampResult = {
  pricePerToken: number;
  totalPremium: number;
  marketPricePerToken: number;
  atFloor: boolean;
};

/** On-ramp: we sell crypto to user. Price = provider buy * (1 + premium), floor at cost basis. */
export function quoteOnRamp(input: QuoteOnRampInput): QuoteOnRampResult {
  const { providerPrice, baseProfit, volatility, minSellingPrice } = input;
  if (providerPrice <= 0) {
    throw new Error("providerPrice must be positive");
  }
  const avgBuyPrice = input.avgBuyPrice ?? 0;
  const inventoryRisk = avgBuyPrice > providerPrice
    ? Math.max(0, (avgBuyPrice - providerPrice) / providerPrice)
    : 0;
  const volatilityPremium = volatilityToPremium(volatility);
  const totalPremium = Math.min(baseProfit + inventoryRisk + volatilityPremium, TOTAL_PREMIUM_CAP);
  const marketPricePerToken = providerPrice * (1 + totalPremium);
  const floor = minSellingPrice != null && minSellingPrice > 0 ? minSellingPrice : null;
  const atFloor = floor != null && marketPricePerToken < floor;
  const pricePerToken = atFloor ? floor : marketPricePerToken;
  return {
    pricePerToken,
    totalPremium,
    marketPricePerToken,
    atFloor,
  };
}

export type QuoteOffRampInput = {
  providerPrice: number; // provider sell price (we sell to provider)
  baseProfit: number;
  volatility: number;
  fiatUtilization?: number; // 0–1
  maxBuyPrice?: number;    // cap (e.g. provider sell)
};

export type QuoteOffRampResult = {
  pricePerToken: number;
  totalDiscount: number;
};

/** Off-ramp: we buy crypto from user. Price = provider sell * (1 - discount), cap at maxBuyPrice. */
export function quoteOffRamp(input: QuoteOffRampInput): QuoteOffRampResult {
  const { providerPrice, baseProfit, volatility, maxBuyPrice } = input;
  if (providerPrice <= 0) {
    throw new Error("providerPrice must be positive");
  }
  const fiatUtil = Math.min(1, Math.max(0, input.fiatUtilization ?? 0));
  const volatilityPremium = volatilityToPremium(volatility);
  const fiatRiskPremium = fiatUtil * 0.02;
  const totalDiscount = Math.min(baseProfit + volatilityPremium + fiatRiskPremium, TOTAL_DISCOUNT_CAP);
  let pricePerToken = providerPrice * (1 - totalDiscount);
  if (maxBuyPrice != null && maxBuyPrice > 0 && pricePerToken > maxBuyPrice) {
    pricePerToken = maxBuyPrice;
  }
  return {
    pricePerToken,
    totalDiscount,
  };
}

/** Apply platform fee (percent e.g. 1) + provider fee (decimal e.g. 0.005) to get effective base profit (decimal). */
export function effectiveBaseProfit(platformFeePercent: number, providerFeeDecimal: number): number {
  const platform = platformFeePercent / 100;
  const provider = typeof providerFeeDecimal === "number" ? providerFeeDecimal : 0;
  return Math.min(platform + provider, 0.06);
}

// --- Auto base profit (plan §4.2–4.5) ---

/** Inventory → base profit (auto mode). 1% at balanced (0.5), 2.5% at 0 or 1. Clamp ratio to [0, 1]. */
export function inventoryBaseProfitFromRatio(params: {
  inventoryRatio: number;
  targetInventory?: number;
  minPct?: number;
  maxPct?: number;
}): number {
  const target = params.targetInventory ?? 0.5;
  const minPct = params.minPct ?? 0.01;
  const maxPct = params.maxPct ?? 0.025;
  const ratio = Math.min(1, Math.max(0, params.inventoryRatio));
  const deviation = Math.abs(ratio - target);
  const normalized = Math.min(deviation * 2, 1);
  return minPct + (maxPct - minPct) * normalized;
}

/** Velocity → adjustment (auto mode). >30/h: -0.5%; >15: -0.2%; <5: +0.5%; 5–15: 0. */
export function velocityAdjustment(tradesPerHour: number): number {
  const t = tradesPerHour < 0 ? 0 : tradesPerHour;
  if (t > 30) return -0.005;
  if (t > 15) return -0.002;
  if (t < 5) return 0.005;
  return 0;
}

/** Volatility → base adjustment (auto mode). Adds 0–1.5% when volatility is high. */
export function volatilityAdjustmentToBase(volatility: number): number {
  const v = volatility < 0 ? 0 : volatility;
  if (v < 0.005) return 0;
  if (v < 0.015) return 0.005;
  if (v < 0.03) return 0.01;
  return 0.015;
}

/** Effective base profit in auto mode: inventory + velocity + volatility, clamped to [1%, 4.5%]. */
export function calculateBaseProfit(params: {
  inventoryRatio: number;
  tradesPerHour: number;
  volatility?: number;
}): number {
  const inventoryPart = inventoryBaseProfitFromRatio({ inventoryRatio: params.inventoryRatio });
  const velocityAdj = velocityAdjustment(params.tradesPerHour);
  const volAdj = params.volatility != null ? volatilityAdjustmentToBase(params.volatility) : 0;
  const raw = inventoryPart + velocityAdj + volAdj;
  return Math.min(0.045, Math.max(0.01, raw));
}
