/**
 * Derive absolute USD prices and exchange rate for a transaction from the legacy relative prices.
 * Used when creating transactions from webhook/order (which still sends f_price, t_price as exchange rate).
 */

const USD_STABLECOINS = ["USDC", "USDT", "USD"];

function isStablecoin(token: string): boolean {
  return USD_STABLECOINS.includes(String(token).toUpperCase());
}

export type DeriveTransactionPricesInput = {
  f_token: string;
  t_token: string;
  /** Legacy: from-side rate (e.g. GHS per USDC for sell, or 1 for buy). */
  f_price: number;
  /** Legacy: to-side rate (e.g. GHS per USDC for buy, or 1 for sell). */
  t_price: number;
  f_amount: number;
  t_amount: number;
  action: "buy" | "sell" | "request" | "claim";
};

export type DeriveTransactionPricesResult = {
  exchangeRate: number;
  f_tokenPriceUsd: number;
  t_tokenPriceUsd: number;
};

/**
 * Derive exchangeRate and absolute USD prices from legacy f_price/t_price.
 * Rule: stablecoins = 1.0; fiat (e.g. GHS) = 1 / (rate in fiat per USD).
 * Legacy: for BUY (GHS->USDC), t_price = GHS per 1 USDC; for SELL (USDC->GHS), f_price = GHS per 1 USDC.
 */
export function deriveTransactionPrices(input: DeriveTransactionPricesInput): DeriveTransactionPricesResult {
  const { f_token, t_token, f_price, t_price, f_amount, t_amount } = input;
  const fStable = isStablecoin(f_token);
  const tStable = isStablecoin(t_token);

  let f_tokenPriceUsd: number;
  let t_tokenPriceUsd: number;

  if (fStable && tStable) {
    f_tokenPriceUsd = 1;
    t_tokenPriceUsd = 1;
  } else if (fStable && !tStable) {
    // From = USDC, to = GHS (offramp). Legacy: f_price = GHS per USDC.
    f_tokenPriceUsd = 1;
    t_tokenPriceUsd = f_price > 0 ? 1 / f_price : 0;
  } else if (!fStable && tStable) {
    // From = GHS, to = USDC (onramp). Legacy: t_price = GHS per USDC.
    f_tokenPriceUsd = t_price > 0 ? 1 / t_price : 0;
    t_tokenPriceUsd = 1;
  } else {
    // Both non-USD (e.g. GHS/NGN). Use t_price or f_price as rate to USD; assume one side is reference.
    const rateToUsd = t_price > 0 ? 1 / t_price : f_price > 0 ? 1 / f_price : 0;
    f_tokenPriceUsd = f_price > 0 ? 1 / f_price : rateToUsd;
    t_tokenPriceUsd = t_price > 0 ? 1 / t_price : rateToUsd;
  }

  const exchangeRate = f_amount > 0 ? t_amount / f_amount : 0;

  return {
    exchangeRate: Number.isFinite(exchangeRate) ? exchangeRate : 0,
    f_tokenPriceUsd: Number.isFinite(f_tokenPriceUsd) ? f_tokenPriceUsd : 0,
    t_tokenPriceUsd: Number.isFinite(t_tokenPriceUsd) ? t_tokenPriceUsd : 0,
  };
}

/**
 * Derive legacy f_price/t_price from amounts and action when client does not send them.
 * Used by GET /api/quote and POST /webhook/order so the platform determines effective rate.
 * BUY (from→to): t_price = from per to = f_amount/t_amount, f_price = 1.
 * SELL: f_price = from per to = t_amount/f_amount, t_price = 1.
 * REQUEST/CLAIM: f_price = 1, t_price = 1 (or from amounts if different tokens).
 */
export function derivePricesFromAmounts(
  action: "buy" | "sell" | "request" | "claim",
  f_amount: number,
  t_amount: number
): { f_price: number; t_price: number } {
  if (f_amount <= 0 || t_amount <= 0) {
    return { f_price: 1, t_price: 1 };
  }
  const rate = t_amount / f_amount;
  switch (action) {
    case "buy":
      return { f_price: 1, t_price: 1 / rate }; // t_price = from per to = f_amount/t_amount
    case "sell":
      return { f_price: rate, t_price: 1 }; // f_price = from per to = t_amount/f_amount
    case "request":
    case "claim":
    default:
      return { f_price: 1, t_price: 1 };
  }
}

/**
 * Fee is taken in f_token for BUY/REQUEST/CLAIM (user pays extra in from-currency), in t_token for SELL (deducted from receive).
 */
export function feeInUsdFromAmount(
  feeAmount: number,
  type: "BUY" | "SELL" | "REQUEST" | "CLAIM" | "TRANSFER",
  f_tokenPriceUsd: number | null | undefined,
  t_tokenPriceUsd: number | null | undefined
): number {
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) return 0;
  if (type === "TRANSFER") return 0;
  const priceUsd = type === "SELL" ? t_tokenPriceUsd : f_tokenPriceUsd;
  const p = priceUsd != null && Number.isFinite(priceUsd) ? priceUsd : 0;
  return Math.round(feeAmount * p * 1e8) / 1e8;
}
