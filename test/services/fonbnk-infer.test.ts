import { describe, it, expect } from "vitest";
import { inferFonbnkCodeFromChainAndSymbol } from "../../src/services/fonbnk.service.js";

describe("inferFonbnkCodeFromChainAndSymbol", () => {
  it("maps BSC USDC to BNB_USDC", () => {
    expect(inferFonbnkCodeFromChainAndSymbol(56, "USDC")).toBe("BNB_USDC");
  });

  it("maps Base USDC to BASE_USDC", () => {
    expect(inferFonbnkCodeFromChainAndSymbol(8453, "USDC")).toBe("BASE_USDC");
  });

  it("maps Solana SOL to SOLANA_NATIVE", () => {
    expect(inferFonbnkCodeFromChainAndSymbol(101, "SOL")).toBe("SOLANA_NATIVE");
  });

  it("returns null for unknown pair", () => {
    expect(inferFonbnkCodeFromChainAndSymbol(99999, "USDC")).toBeNull();
  });
});
