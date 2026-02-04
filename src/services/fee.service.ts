/**
 * Mock fee service — will be replaced with real pricing/fee logic later.
 * Backend can prefetch quote before creating a transaction.
 * f_price/t_price are optional; when omitted the platform derives from amounts.
 */

import { derivePricesFromAmounts } from "./transaction-price.service.js";

export type OrderAction = "buy" | "sell" | "request" | "claim";

export type FeeQuoteInput = {
  action: OrderAction;
  f_amount: number;
  t_amount: number;
  /** Optional; platform derives from amounts when omitted. */
  f_price?: number;
  /** Optional; platform derives from amounts when omitted. */
  t_price?: number;
  f_chain?: string;
  t_chain?: string;
  f_token: string;
  t_token: string;
};

export type FeeQuoteResult = {
  /** Fee amount in f_token (for buy/request: user pays; for sell/claim: deducted from user receive) */
  feeAmount: number;
  /** Fee as percentage (e.g. 1 = 1%) */
  feePercent: number;
  /** Total cost to user in f_token (f_amount + fee for buy/request; for sell/claim: t_amount * t_price - fee) */
  totalCost: number;
  /** Total received by user in t_token equivalent (after fee for sell/claim) */
  totalReceived: number;
  /** Effective rate after fee (f_token per t_token) */
  rate: number;
  /** Gross value in f_token (f_amount or t_amount * t_price) */
  grossValue: number;
  /** Profit to platform (fee income) in f_token */
  profit: number;
};

/** Mock fee percentages per action (replace with config or real logic later) */
const MOCK_FEE_PERCENT: Record<OrderAction, number> = {
  buy: 1,
  sell: 1,
  request: 0.5,
  claim: 0.5,
};

/**
 * Mock: compute fee and quote for an order. Backend can call this (or GET /api/quote) before creating the transaction.
 * When f_price/t_price are omitted, they are derived from f_amount/t_amount and action.
 */
export function getFeeForOrder(input: FeeQuoteInput): FeeQuoteResult {
  const { action, f_amount, t_amount } = input;
  const derived = derivePricesFromAmounts(action, f_amount, t_amount);
  const f_price = input.f_price ?? derived.f_price;
  const t_price = input.t_price ?? derived.t_price;
  const feePercent = MOCK_FEE_PERCENT[action];
  const feePercentDecimal = feePercent / 100;

  let feeAmount: number;
  let totalCost: number;
  let totalReceived: number;
  let grossValue: number;
  let profit: number;

  switch (action) {
    case "buy":
      // User pays f_amount (e.g. USDC) + fee on f_amount. Receives t_amount (e.g. ETH).
      grossValue = f_amount;
      feeAmount = f_amount * feePercentDecimal;
      totalCost = f_amount + feeAmount;
      totalReceived = t_amount;
      profit = feeAmount;
      break;
    case "sell":
      // User sends t_amount (e.g. ETH), receives f_amount (e.g. USDC). Fee deducted from receive.
      grossValue = t_amount * t_price; // or f_amount
      feeAmount = f_amount * feePercentDecimal;
      totalCost = t_amount; // amount they send
      totalReceived = f_amount - feeAmount;
      profit = feeAmount;
      break;
    case "request":
    case "claim":
      // Request/claim: fee on requested amount (f_amount).
      grossValue = f_amount;
      feeAmount = f_amount * feePercentDecimal;
      totalCost = f_amount + feeAmount;
      totalReceived = f_amount; // they receive f_amount, fee is extra cost
      profit = feeAmount;
      break;
    default:
      grossValue = f_amount;
      feeAmount = 0;
      totalCost = f_amount;
      totalReceived = t_amount;
      profit = 0;
  }

  // Effective rate (f_token per t_token): for buy (onramp) t_price = output price (fiat per crypto); for sell (offramp) f_price = output price (fiat per crypto).
  const rate =
    action === "buy"
      ? t_price
      : action === "sell"
        ? (f_price !== 0 ? 1 / f_price : 0)
        : t_price !== 0
          ? f_price / t_price
          : 0;

  return {
    feeAmount: Math.round(feeAmount * 1e8) / 1e8,
    feePercent,
    totalCost: Math.round(totalCost * 1e8) / 1e8,
    totalReceived: Math.round(totalReceived * 1e8) / 1e8,
    rate,
    grossValue: Math.round(grossValue * 1e8) / 1e8,
    profit: Math.round(profit * 1e8) / 1e8,
  };
}

/**
 * Compute profit for a completed order (for admin/reporting). Uses same mock fee.
 */
export function getProfitForOrder(input: FeeQuoteInput): number {
  return getFeeForOrder(input).profit;
}

/** Transaction-like shape for fee computation (spread-based). TRANSFER yields 0. */
export type TransactionForFee = {
  type: "BUY" | "SELL" | "REQUEST" | "CLAIM" | "TRANSFER";
  f_amount: number | { toString(): string };
  t_amount: number | { toString(): string };
  f_tokenPriceUsd?: number | { toString(): string } | null;
  t_tokenPriceUsd?: number | { toString(): string } | null;
  providerPrice?: number | { toString(): string } | null;
};

function toNum(v: number | { toString(): string } | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(String(v)) || 0;
}

/**
 * Compute transaction fee for completion (spread-based).
 * Uses f_tokenPriceUsd / t_tokenPriceUsd to get platform price in "quote per base" for spread.
 * BUY: selling price (fiat per crypto) = t_tokenPriceUsd / f_tokenPriceUsd; fee = (sellingPrice - providerPrice) * t_amount.
 * SELL: buy price (fiat per crypto) = f_tokenPriceUsd / t_tokenPriceUsd; fee = (providerPrice - buyPrice) * f_amount.
 * REQUEST/CLAIM: fallback to getFeeForOrder (percentage).
 */
export function computeTransactionFee(tx: TransactionForFee): number {
  const fAmount = toNum(tx.f_amount);
  const tAmount = toNum(tx.t_amount);
  const fTokenPriceUsd = toNum(tx.f_tokenPriceUsd);
  const tTokenPriceUsd = toNum(tx.t_tokenPriceUsd);
  const providerPrice = tx.providerPrice != null ? toNum(tx.providerPrice) : undefined;

  switch (tx.type) {
    case "BUY": {
      if (fTokenPriceUsd <= 0) return 0;
      const sellingPrice = tTokenPriceUsd / fTokenPriceUsd;
      const provider = providerPrice ?? sellingPrice;
      const fee = (sellingPrice - provider) * tAmount;
      return Math.round(fee * 1e8) / 1e8;
    }
    case "SELL": {
      if (providerPrice == null || !Number.isFinite(providerPrice)) return 0;
      if (tTokenPriceUsd <= 0) return 0;
      const buyPrice = fTokenPriceUsd / tTokenPriceUsd;
      const spreadFiat = (providerPrice - buyPrice) * fAmount;
      return Math.round(spreadFiat * 1e8) / 1e8;
    }
    case "REQUEST":
    case "CLAIM":
      return getFeeForOrder({
        action: tx.type.toLowerCase() as OrderAction,
        f_amount: fAmount,
        t_amount: tAmount,
        f_price: fTokenPriceUsd > 0 ? 1 / fTokenPriceUsd : 1,
        t_price: tTokenPriceUsd > 0 ? 1 / tTokenPriceUsd : 1,
        f_token: "",
        t_token: "",
      }).feeAmount;
    default:
      return 0;
  }
}
