/**
 * Server-side swap quote estimates when no user wallet is connected.
 * LiFi POST /advanced/routes rejects `fromAddress` = 0x0 ("Zero address is provided").
 * Squid quote-only flows accept a non-zero placeholder for routing estimates.
 */
export const SWAP_QUOTE_ESTIMATE_FROM_ADDRESS =
  "0x000000000000000000000000000000000000dEaD";

function isEvmAddress(v: string): boolean {
  const s = v.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

/**
 * Returns a stable non-zero EVM address for quote-only routing estimates.
 * If `QUOTE_ESTIMATE_FROM_ADDRESS` is set in Core env and valid, it is preferred.
 */
export function getSwapQuoteEstimateFromAddress(): string {
  const env = process.env.QUOTE_ESTIMATE_FROM_ADDRESS?.trim();
  if (env && isEvmAddress(env)) return env;
  return SWAP_QUOTE_ESTIMATE_FROM_ADDRESS;
}
