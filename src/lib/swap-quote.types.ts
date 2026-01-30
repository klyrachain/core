/**
 * Unified swap quote types for 0x, Squid, and LiFi.
 * Single endpoint POST /api/quote/swap with provider param.
 */

export const SWAP_QUOTE_PROVIDERS = ["0x", "squid", "lifi"] as const;
export type SwapQuoteProvider = (typeof SWAP_QUOTE_PROVIDERS)[number];

export type SwapQuoteRequest = {
  provider: SwapQuoteProvider;
  from_token: string;
  to_token: string;
  amount: string; // wei/smallest unit
  from_chain: number; // chain id
  to_chain: number; // chain id
  from_address?: string; // required for Squid/LiFi
  to_address?: string;
  slippage?: number;
};

/** Request for best-quote endpoint (no provider; we call all applicable). */
export type BestQuoteRequest = Omit<SwapQuoteRequest, "provider"> & {
  from_address: string; // required for Squid/LiFi so best can call them
};

/** Chain/token swap type indicators for UI and downstream. */
export type SwapQuoteResponse = {
  provider: SwapQuoteProvider;
  from_chain_id: number;
  to_chain_id: number;
  cross_chain: boolean;
  same_chain: boolean;
  token_type: "cross_token" | "same_token";
  from_amount: string;
  to_amount: string;
  /** Seconds after which quote should be refreshed (quote validity); null if provider does not return. */
  next_quote_timer_seconds: number | null;
  /** Estimated time in seconds for the swap to complete (execution duration). Used for "best by speed". */
  estimated_duration_seconds: number | null;
  /** Transaction/calldata if provider returns it in quote (0x, Squid). LiFi requires separate stepTransaction. */
  transaction: SwapQuoteTransaction | null;
};

export type SwapQuoteTransaction = {
  /** Target contract address (Squid) or similar. */
  target?: string;
  /** Calldata hex. */
  data?: string;
  /** Value in wei (native token). */
  value?: string;
  gas_limit?: string;
  gas_price?: string;
  max_fee_per_gas?: string;
  max_priority_fee_per_gas?: string;
  /** 0x-specific: permit2 and full raw for signing. */
  raw?: Record<string, unknown>;
};

/** Response for POST /api/quote/best: best by rate, optional second competitive quote (by amount or speed). */
export type BestQuoteResponse = {
  best: SwapQuoteResponse;
  alternative?: SwapQuoteResponse;
};
