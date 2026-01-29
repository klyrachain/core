/**
 * Mock fee service — will be replaced with real pricing/fee logic later.
 * Backend can prefetch quote before creating a transaction.
 */

export type OrderAction = "buy" | "sell" | "request" | "claim";

export type FeeQuoteInput = {
  action: OrderAction;
  f_amount: number;
  t_amount: number;
  f_price: number;
  t_price: number;
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
 */
export function getFeeForOrder(input: FeeQuoteInput): FeeQuoteResult {
  const { action, f_amount, t_amount, f_price, t_price } = input;
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

  const rate = t_price !== 0 ? f_price / t_price : 0;

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
