/**
 * Checkout quote row definitions for POST /api/v1/quotes/checkout.
 * `offramp` = fiat invoice covered by selling crypto (Fonbnk).
 * `composite_wxrp` = Base USDC offramp amount → swap quote to Ethereum WXRP (server-side).
 */

export type CheckoutOfframpRowSpec = {
  id: string;
  kind: "offramp";
  chain: string;
  symbol: string;
  /**
   * Contract / mint address from token picker (EVM 0x… or non-EVM mint).
   * When set, quotes resolve SupportedToken by address so the correct asset is used if symbols collide.
   */
  tokenAddress?: string;
};

export type CheckoutCompositeWxrpRowSpec = {
  id: string;
  kind: "composite_wxrp";
};

export type CheckoutRowSpec = CheckoutOfframpRowSpec | CheckoutCompositeWxrpRowSpec;

export const DEFAULT_CHECKOUT_ROWS: CheckoutRowSpec[] = [
  { id: "base-usdc", kind: "offramp", chain: "BASE", symbol: "USDC" },
  { id: "bnb-usdc", kind: "offramp", chain: "BNB", symbol: "USDC" },
  { id: "solana-sol", kind: "offramp", chain: "SOLANA", symbol: "SOL" },
  { id: "eth-wxrp", kind: "composite_wxrp" },
];
