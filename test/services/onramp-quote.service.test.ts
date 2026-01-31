import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetFonbnkQuote = vi.fn();
const mockGetBestQuotes = vi.fn();

const FONBNK_SUPPORTED = new Set([
  "BASE_USDC",
  "ETHEREUM_USDC",
  "ETHEREUM_NATIVE",
]);
vi.mock("../../src/services/fonbnk.service.js", () => ({
  getFonbnkQuote: (req: unknown) => mockGetFonbnkQuote(req),
  getCurrencyForCountry: (code: string) => (code === "GH" ? "GHS" : "USD"),
  isFonbnkSupportedPayoutCode: (code: string) =>
    FONBNK_SUPPORTED.has(code.trim().toUpperCase()),
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

  describe("getOnrampQuote (pool token not in Fonbnk list)", () => {
    it("uses intermediate + swap when pool token is Base ETH (not in Fonbnk list)", async () => {
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
      mockGetBestQuotes.mockResolvedValue({
        ok: true,
        data: {
          best: {
            from_chain_id: 8453,
            from_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            to_chain_id: 8453,
            to_token: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            from_amount: "7920000",
            to_amount: "5000000000000000000",
            provider: "0x",
          },
        },
      });
      const mod = await loadOnrampQuoteService();
      const result = await mod.getOnrampQuote({
        country: "GH",
        chain_id: 8453,
        token: "ETH",
        amount: 100,
        amount_in: "fiat",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.swap).toBeDefined();
        expect(mockGetFonbnkQuote).toHaveBeenCalledWith(
          expect.objectContaining({ token: "BASE_USDC" })
        );
        expect(mockGetBestQuotes).toHaveBeenCalled();
      }
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
