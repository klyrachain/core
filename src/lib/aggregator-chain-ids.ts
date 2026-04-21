/**
 * Maps internal Prisma/checkout chain ids to ids expected by swap aggregators.
 * Internal Solana uses `101` (see seed / SupportedToken); LiFi and Squid use their own identifiers.
 *
 * LiFi: https://li.quest/v1/chains?chainTypes=SVM → Solana `id` 1151111081099710
 * Squid v2: string `solana-mainnet-beta` (see Squid docs — Bitcoin and Solana)
 */
export const INTERNAL_CHAIN_ID_SOLANA = 101;

/** Internal Stellar chain id (see `app-transfer` / checkout non-EVM ids). */
export const INTERNAL_CHAIN_ID_STELLAR = 148;

/** Internal Bitcoin chain id. */
export const INTERNAL_CHAIN_ID_BITCOIN = 8332;

/** LiFi `fromChainId` / `toChainId` for Solana mainnet (SVM). */
export const LIFI_CHAIN_ID_SOLANA = 1151111081099710;

/** Squid `fromChain` / `toChain` value for Solana mainnet. */
export const SQUID_CHAIN_SLUG_SOLANA = "solana-mainnet-beta";

export function toLiFiChainId(internalChainId: number): number {
  if (internalChainId === INTERNAL_CHAIN_ID_SOLANA) return LIFI_CHAIN_ID_SOLANA;
  return internalChainId;
}

/** Squid accepts numeric chain ids as strings for EVM; Solana uses a named slug. */
export function toSquidChainParam(internalChainId: number): string {
  if (internalChainId === INTERNAL_CHAIN_ID_SOLANA) return SQUID_CHAIN_SLUG_SOLANA;
  return String(internalChainId);
}
