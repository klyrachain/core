/**
 * Map Core transaction `f_chain` / pool chain codes to ecosystem and EVM numeric chainId (when applicable).
 */

export type PaymentEcosystem =
  | "EVM"
  | "SOLANA"
  | "STELLAR"
  | "BITCOIN"
  | "SUI"
  | "TRON"
  | "APTOS"
  | "OTHER";

const EVM_CHAIN_CODES = new Set(
  [
    "ETHEREUM",
    "BASE",
    "BASE SEPOLIA",
    "BNB",
    "POLYGON",
    "ARBITRUM",
    "OPTIMISM",
    "AVALANCHE",
    "FANTOM",
    "GNOSIS",
    "LINEA",
    "SCROLL",
    "BLAST",
    "MANTLE",
    "ZKSYNC",
    "POLYGON_ZKEVM",
    "CRONOS",
    "MOONBEAM",
    "MOONRIVER",
    "CELO",
    "METIS",
    "BOBA",
    "MODE",
    "ZORA",
    "INK",
    "SONEIUM",
  ].map((s) => s.toUpperCase())
);

/** Core chain name / code → viem-style chain id for RPC verification (EVM only). */
export const CORE_CHAIN_TO_EVM_CHAIN_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  "BASE SEPOLIA": 84532,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  AVALANCHE: 43114,
  FANTOM: 250,
  GNOSIS: 100,
  LINEA: 59144,
  SCROLL: 534352,
  BLAST: 81457,
  MANTLE: 5000,
  ZKSYNC: 324,
  POLYGON_ZKEVM: 1101,
};

export function ecosystemFromCoreChain(fChain: string | null | undefined): PaymentEcosystem {
  const u = (fChain ?? "").trim().toUpperCase().replace(/-/g, " ");
  if (u === "SOLANA") return "SOLANA";
  if (u === "STELLAR") return "STELLAR";
  if (u === "BITCOIN") return "BITCOIN";
  if (u === "SUI") return "SUI";
  if (u === "TRON") return "TRON";
  if (u === "APTOS") return "APTOS";
  if (EVM_CHAIN_CODES.has(u)) return "EVM";
  return "OTHER";
}

export function evmChainIdFromCoreChain(fChain: string | null | undefined): number | null {
  const u = (fChain ?? "").trim().toUpperCase().replace(/-/g, " ");
  if (ecosystemFromCoreChain(fChain) !== "EVM") return null;
  return CORE_CHAIN_TO_EVM_CHAIN_ID[u] ?? null;
}
