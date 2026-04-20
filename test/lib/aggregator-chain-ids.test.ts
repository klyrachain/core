import { describe, expect, it } from "vitest";
import {
  INTERNAL_CHAIN_ID_SOLANA,
  LIFI_CHAIN_ID_SOLANA,
  SQUID_CHAIN_SLUG_SOLANA,
  toLiFiChainId,
  toSquidChainParam,
} from "../../src/lib/aggregator-chain-ids.js";

describe("aggregator-chain-ids", () => {
  it("maps internal Solana to LiFi chain id", () => {
    expect(toLiFiChainId(INTERNAL_CHAIN_ID_SOLANA)).toBe(LIFI_CHAIN_ID_SOLANA);
    expect(toLiFiChainId(8453)).toBe(8453);
  });

  it("maps internal Solana to Squid chain slug", () => {
    expect(toSquidChainParam(INTERNAL_CHAIN_ID_SOLANA)).toBe(SQUID_CHAIN_SLUG_SOLANA);
    expect(toSquidChainParam(1)).toBe("1");
  });
});
