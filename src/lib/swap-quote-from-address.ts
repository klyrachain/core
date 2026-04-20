import { INTERNAL_CHAIN_ID_SOLANA } from "./aggregator-chain-ids.js";

/**
 * Server-side swap quote estimates when no user wallet is connected.
 * LiFi POST /advanced/routes rejects `fromAddress` = 0x0 ("Zero address is provided").
 * Squid quote-only flows accept a non-zero placeholder for routing estimates.
 * For **Solana (SVM)**, LiFi/Squid require a valid base58 **wallet** pubkey — EVM hex is invalid.
 */
export const SWAP_QUOTE_ESTIMATE_FROM_ADDRESS =
  "0x000000000000000000000000000000000000dEaD";

/** Example wallet from Squid Solana docs; valid base58 pubkey for quote-only `fromAddress`. */
export const SWAP_QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA =
  "35tWpkpFr7UawcpuXm6ir1nN1v5tfoJgKj84xv1YukZn";

function isEvmAddress(v: string): boolean {
  const s = v.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isSolanaPubkeyLike(v: string): boolean {
  const s = v.trim();
  if (s.startsWith("0x")) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(s);
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

/**
 * Valid Solana pubkey for aggregator quote requests when the route is on SVM.
 * Override with `QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA` in env if needed.
 */
export function getSwapQuoteEstimateFromAddressSolana(): string {
  const env = process.env.QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA?.trim();
  if (env && isSolanaPubkeyLike(env)) return env;
  return SWAP_QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA;
}

/**
 * Resolves `fromAddress` for swap quotes: use a connected Solana wallet when provided;
 * otherwise EVM placeholder or Solana placeholder by chain.
 */
export function resolveSwapQuoteFromAddress(params: {
  from_chain: number;
  to_chain: number;
  /** Optional client wallet — EVM 0x… or Solana base58. */
  hint?: string | null;
}): string {
  const hint = params.hint?.trim();
  const usesSol =
    params.from_chain === INTERNAL_CHAIN_ID_SOLANA ||
    params.to_chain === INTERNAL_CHAIN_ID_SOLANA;
  if (usesSol && hint && isSolanaPubkeyLike(hint)) {
    return hint;
  }
  if (usesSol) {
    return getSwapQuoteEstimateFromAddressSolana();
  }
  if (hint && isEvmAddress(hint)) {
    return hint;
  }
  return getSwapQuoteEstimateFromAddress();
}
