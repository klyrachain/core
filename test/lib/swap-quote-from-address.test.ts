import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveSwapQuoteFromAddress,
  SWAP_QUOTE_ESTIMATE_FROM_ADDRESS,
  SWAP_QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA,
} from "../../src/lib/swap-quote-from-address.js";
import {
  INTERNAL_CHAIN_ID_SOLANA,
  INTERNAL_CHAIN_ID_STELLAR,
} from "../../src/lib/aggregator-chain-ids.js";
import {
  __resetPlatformQuoteWalletsForTests,
  __setPlatformQuoteWalletForTests,
} from "../../src/lib/platform-quote-wallets.js";

describe("resolveSwapQuoteFromAddress", () => {
  beforeEach(() => {
    __resetPlatformQuoteWalletsForTests();
  });
  afterEach(() => {
    __resetPlatformQuoteWalletsForTests();
  });

  it("uses Solana pubkey placeholder for SVM chains", () => {
    const a = resolveSwapQuoteFromAddress({
      from_chain: INTERNAL_CHAIN_ID_SOLANA,
      to_chain: INTERNAL_CHAIN_ID_SOLANA,
      hint: undefined,
    });
    expect(a).toBe(SWAP_QUOTE_ESTIMATE_FROM_ADDRESS_SOLANA);
  });

  it("uses EVM placeholder when no Solana", () => {
    const a = resolveSwapQuoteFromAddress({
      from_chain: 8453,
      to_chain: 8453,
      hint: undefined,
    });
    expect(a).toBe(SWAP_QUOTE_ESTIMATE_FROM_ADDRESS);
  });

  it("uses hint when client passes a Solana pubkey", () => {
    const pk = "11111111111111111111111111111112";
    const a = resolveSwapQuoteFromAddress({
      from_chain: INTERNAL_CHAIN_ID_SOLANA,
      to_chain: INTERNAL_CHAIN_ID_SOLANA,
      hint: pk,
    });
    expect(a).toBe(pk);
  });

  it("uses Infisical-backed Stellar wallet when route touches Stellar", () => {
    const stellar = `G${"A".repeat(55)}`;
    __setPlatformQuoteWalletForTests("stellar", stellar);
    const a = resolveSwapQuoteFromAddress({
      from_chain: INTERNAL_CHAIN_ID_STELLAR,
      to_chain: 8453,
      hint: undefined,
    });
    expect(a).toBe(stellar);
  });
});
