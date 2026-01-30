import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetFonbnkQuote = vi.fn();
const mockGetBestQuotes = vi.fn();

vi.mock("../../src/services/fonbnk.service.js", () => ({
  getFonbnkQuote: (req: unknown) => mockGetFonbnkQuote(req),
  getCurrencyForCountry: (code: string) => (code === "GH" ? "GHS" : "USD"),
}));

vi.mock("../../src/services/swap-quote.service.js", () => ({
  getBestQuotes: (req: unknown) => mockGetBestQuotes(req),
}));

async function loadOnrampQuoteService() {
  return await import("../../src/services/onramp-quote.service.js");
}

describe("onramp-quote.service", () => {
  beforeEach(() => {
    mockGetFonbnkQuote.mockReset();
    mockGetBestQuotes.mockReset();
  });

  describe("getOnrampQuote (pool token, buy)", () => {
    it("returns direct Fonbnk quote when token is pool token (Base USDC)", async () => {
      mockGetFonbnkQuote.mockResolvedValue({
        country: "GH",
        currency: "GHS",
        network: "base",
        asset: "USDC",
        amount: 100,
        rate: 12.5,
        fee: 1.2,
        total: 7.92,
        paymentChannel: "mobile_money",
        purchaseMethod: "buy",
        amountIn: "fiat",
      });
      const mod = await loadOnrampQuoteService();
      const result = await mod.getOnrampQuote({
        country: "GH",
        chain_id: 8453,
        token: "USDC",
        amount: 100,
        amount_in: "fiat",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total_fiat).toBe(100);
        expect(result.data.total_crypto).toBe("7.92");
        expect(result.data.swap).toBeUndefined();
      }
      expect(mockGetBestQuotes).not.toHaveBeenCalled();
      expect(mockGetFonbnkQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          country: "GH",
          token: "BASE_USDC",
          purchaseMethod: "buy",
          amount: 100,
          amountIn: "fiat",
        })
      );
    });
  });

  describe("getOnrampQuote (pool token, sell)", () => {
    it("returns direct Fonbnk sell quote when token is pool token", async () => {
      mockGetFonbnkQuote.mockResolvedValue({
        country: "GH",
        currency: "GHS",
        network: "base",
        asset: "USDC",
        amount: 10,
        rate: 12.5,
        fee: 0.5,
        total: 118.75,
        paymentChannel: "mobile_money",
        purchaseMethod: "sell",
        amountIn: "crypto",
      });
      const mod = await loadOnrampQuoteService();
      const result = await mod.getOnrampQuote({
        country: "GH",
        chain_id: 8453,
        token: "USDC",
        amount: 10,
        amount_in: "crypto",
        purchase_method: "sell",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total_fiat).toBe(118.75);
        expect(result.data.total_crypto).toBe("10");
        expect(result.data.swap).toBeUndefined();
      }
      expect(mockGetFonbnkQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseMethod: "sell",
          amountIn: "crypto",
        })
      );
    });
  });

  describe("getOnrampQuote (non-pool token)", () => {
    it("returns error when Fonbnk returns null for intermediate pool token", async () => {
      mockGetFonbnkQuote.mockResolvedValue(null);
      const mod = await loadOnrampQuoteService();
      const result = await mod.getOnrampQuote({
        country: "GH",
        chain_id: 8453,
        token: "0xMANA",
        amount: 100,
        amount_in: "fiat",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Fonbnk");
      }
    });

    it("returns error when swap quote fails for non-pool token", async () => {
      mockGetFonbnkQuote.mockResolvedValue({
        country: "GH",
        currency: "GHS",
        network: "base",
        asset: "USDC",
        amount: 100,
        rate: 12.5,
        fee: 1,
        total: 7.92,
        paymentChannel: "mobile_money",
        purchaseMethod: "buy",
        amountIn: "fiat",
      });
      mockGetBestQuotes.mockResolvedValue({ ok: false, error: "No route" });
      const mod = await loadOnrampQuoteService();
      const result = await mod.getOnrampQuote({
        country: "GH",
        chain_id: 8453,
        token: "0xMANA",
        amount: 100,
        amount_in: "fiat",
        from_address: "0xuser",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("No route");
    });
  });
});
