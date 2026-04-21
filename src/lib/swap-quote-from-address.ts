import {
  INTERNAL_CHAIN_ID_BITCOIN,
  INTERNAL_CHAIN_ID_SOLANA,
  INTERNAL_CHAIN_ID_STELLAR,
} from "./aggregator-chain-ids.js";
import { isValidReceiverForEcosystem } from "./payment-address-validation.js";
import { getCachedPlatformQuoteWallet } from "./platform-quote-wallets.js";

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
  const fromVault = getCachedPlatformQuoteWallet("evm");
  if (fromVault && isEvmAddress(fromVault)) return fromVault;
  return SWAP_QUOTE_ESTIMATE_FROM_ADDRESS;
}

/**
 * Valid Solana pubkey for aggregator quote requests when the route is on SVM.
 * Override with `QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA` in env if needed.
 */
export function getSwapQuoteEstimateFromAddressSolana(): string {
  const env = process.env.QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA?.trim();
  if (env && isSolanaPubkeyLike(env)) return env;
  const fromVault = getCachedPlatformQuoteWallet("solana");
  if (fromVault && isSolanaPubkeyLike(fromVault)) return fromVault;
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
  const chainIds = [params.from_chain, params.to_chain];

  const usesSol = chainIds.includes(INTERNAL_CHAIN_ID_SOLANA);
  if (usesSol && hint && isSolanaPubkeyLike(hint)) {
    return hint;
  }
  if (usesSol) {
    return getSwapQuoteEstimateFromAddressSolana();
  }

  const usesStellar = chainIds.includes(INTERNAL_CHAIN_ID_STELLAR);
  if (usesStellar) {
    if (hint && isValidReceiverForEcosystem("STELLAR", hint)) return hint;
    const w = getCachedPlatformQuoteWallet("stellar");
    if (w && isValidReceiverForEcosystem("STELLAR", w)) return w;
    return getSwapQuoteEstimateFromAddress();
  }

  const usesBitcoin = chainIds.includes(INTERNAL_CHAIN_ID_BITCOIN);
  if (usesBitcoin) {
    if (hint && isValidReceiverForEcosystem("BITCOIN", hint)) return hint;
    const w = getCachedPlatformQuoteWallet("bitcoin");
    if (w && isValidReceiverForEcosystem("BITCOIN", w)) return w;
    return getSwapQuoteEstimateFromAddress();
  }

  if (hint && isEvmAddress(hint)) {
    return hint;
  }
  return getSwapQuoteEstimateFromAddress();
}
