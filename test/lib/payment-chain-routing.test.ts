import { describe, expect, it } from "vitest";
import { ecosystemFromCoreChain, evmChainIdFromCoreChain } from "../../src/lib/payment-chain-routing.js";

describe("payment-chain-routing", () => {
  it("maps known EVM chains", () => {
    expect(ecosystemFromCoreChain("BASE")).toBe("EVM");
    expect(evmChainIdFromCoreChain("BASE")).toBe(8453);
  });

  it("maps non-EVM core codes", () => {
    expect(ecosystemFromCoreChain("SOLANA")).toBe("SOLANA");
    expect(ecosystemFromCoreChain("STELLAR")).toBe("STELLAR");
    expect(ecosystemFromCoreChain("BITCOIN")).toBe("BITCOIN");
    expect(evmChainIdFromCoreChain("SOLANA")).toBeNull();
  });
});
