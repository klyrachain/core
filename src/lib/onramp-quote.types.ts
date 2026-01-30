/**
 * Types for onramp quotes: fiat↔crypto via Fonbnk; optional swap when requested token is not in pool.
 */

/** Request for Fonbnk quote: country, token (Fonbnk code e.g. BASE_USDC), buy/sell, amount, amountIn. */
export type FonbnkQuoteRequest = {
  country: string;
  token: string;
  purchaseMethod: "buy" | "sell";
  amount?: number;
  amountIn?: "fiat" | "crypto";
};

/** Fonbnk quote response. amount = input; total = equivalent (crypto or fiat). */
export type FonbnkQuoteResponse = {
  country: string;
  currency: string;
  network: string;
  asset: string;
  amount: number;
  rate: number;
  fee: number;
  total: number;
  paymentChannel: string;
  purchaseMethod: "buy" | "sell";
  amountIn?: "fiat" | "crypto";
};

/** Pool token: chain + token we hold (Base USDC/ETH, Ethereum USDC/ETH). */
export type PoolToken = {
  chainId: number;
  symbol: string;
  address: string;
  fonbnkCode: string;
};

/** Request for onramp quote: country, chain_id, token (address or symbol), amount, amount_in. */
export type OnrampQuoteRequest = {
  country: string;
  chain_id: number;
  token: string;
  amount: number;
  amount_in: "fiat" | "crypto";
  from_address?: string;
  /** Decimals for requested token when not a pool token (used for swap amount conversion). Default 18. */
  token_decimals?: number;
};

/** Onramp quote response: fiat and crypto amounts, rate, fee, optional swap step. */
export type OnrampQuoteResponse = {
  country: string;
  currency: string;
  chain_id: number;
  token: string;
  token_symbol?: string;
  amount: number;
  amount_in: "fiat" | "crypto";
  rate: number;
  fee: number;
  total_crypto: string;
  total_fiat: number;
  /** When requested token is not in pool: pool token used for Fonbnk + swap to requested token. */
  swap?: {
    from_chain_id: number;
    from_token: string;
    to_chain_id: number;
    to_token: string;
    from_amount: string;
    to_amount: string;
    provider: string;
  };
}
