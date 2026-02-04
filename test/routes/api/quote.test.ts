import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { quoteApiRoutes } from "../../../src/routes/api/quote.js";
import * as swapQuoteService from "../../../src/services/swap-quote.service.js";
import * as publicQuoteService from "../../../src/services/public-quote.service.js";
import * as redis from "../../../src/lib/redis.js";

vi.mock("../../../src/services/swap-quote.service.js", () => ({
  getSwapQuote: vi.fn(),
  getBestQuotes: vi.fn(),
}));
vi.mock("../../../src/services/public-quote.service.js", () => ({
  buildPublicQuote: vi.fn(),
}));
vi.mock("../../../src/lib/redis.js", () => ({
  setStoredQuote: vi.fn().mockResolvedValue(undefined),
  QUOTE_TTL_SECONDS: 32,
}));

const mockGetSwapQuote = vi.mocked(swapQuoteService.getSwapQuote);
const mockGetBestQuotes = vi.mocked(swapQuoteService.getBestQuotes);
const mockBuildPublicQuote = vi.mocked(publicQuoteService.buildPublicQuote);
const mockSetStoredQuote = vi.mocked(redis.setStoredQuote);

describe("Quote API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSetStoredQuote.mockResolvedValue(undefined);
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    await app.register(quoteApiRoutes, { prefix: "" });
  });

  describe("GET /api/quote (pricing endpoint)", () => {
    const validQuery = {
      action: "buy",
      amount: "100",
      f_token: "GHS",
      t_token: "USDC",
      chain: "BASE",
    };

    it("returns 400 when query validation fails (missing required)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/quote",
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { success: boolean; error: string; details?: unknown };
      expect(json.success).toBe(false);
      expect(json.error).toContain("Validation");
      expect(json.details).toBeDefined();
      expect(mockBuildPublicQuote).not.toHaveBeenCalled();
    });

    it("returns 400 when action is invalid (only buy, sell, swap supported)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/quote?action=request&amount=100&f_token=GHS&t_token=USDC&chain=BASE",
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { error: string };
      expect(json.error).toContain("Validation");
      expect(mockBuildPublicQuote).not.toHaveBeenCalled();
    });

    it("returns 200 with platform quote (exchangeRate, input, output, fees) when pricing engine succeeds", async () => {
      mockBuildPublicQuote.mockResolvedValue({
        success: true,
        data: {
          quoteId: "q-123",
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          exchangeRate: "15.50",
          input: { amount: "100.00", currency: "GHS" },
          output: { amount: "6.45", currency: "USDC", chain: "BASE" },
          fees: { networkFee: "0", platformFee: "0.50", totalFee: "0.50" },
        },
      });

      const q = new URLSearchParams(validQuery as Record<string, string>).toString();
      const res = await app.inject({
        method: "GET",
        url: `/api/quote?${q}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: Record<string, unknown> };
      expect(json.success).toBe(true);
      expect(json.data).toMatchObject({
        quoteId: "q-123",
        exchangeRate: "15.50",
        input: { amount: "100.00", currency: "GHS" },
        output: { amount: "6.45", currency: "USDC", chain: "BASE" },
        fees: { networkFee: "0", platformFee: "0.50", totalFee: "0.50" },
      });
      expect(mockBuildPublicQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ONRAMP",
          inputAmount: "100",
          inputCurrency: "GHS",
          outputCurrency: "USDC",
          chain: "BASE",
          inputSide: "from",
        })
      );
      expect(mockSetStoredQuote).toHaveBeenCalledWith("q-123", expect.any(String), 32);
    });

    it("returns 400 when pricing engine returns failure", async () => {
      mockBuildPublicQuote.mockResolvedValue({
        success: false,
        error: "chain is required for ONRAMP",
        code: "CHAIN_REQUIRED",
        status: 400,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/quote?action=buy&amount=100&f_token=GHS&t_token=USDC&chain=",
      });

      expect(res.statusCode).toBe(400);
      const json = res.json() as { success: boolean; error: string; code: string };
      expect(json.success).toBe(false);
      expect(json.error).toContain("chain is required");
      expect(json.code).toBe("CHAIN_REQUIRED");
    });

    it("accepts input_side=to (amount is what user wants to receive)", async () => {
      mockBuildPublicQuote.mockResolvedValue({
        success: true,
        data: {
          quoteId: "q-to",
          expiresAt: new Date().toISOString(),
          exchangeRate: "15.50",
          input: { amount: "155.00", currency: "GHS" },
          output: { amount: "10.00", currency: "USDC", chain: "BASE" },
          fees: { networkFee: "0", platformFee: "0.25", totalFee: "0.25" },
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/quote?action=buy&amount=10&input_side=to&f_token=GHS&t_token=USDC&chain=BASE",
      });

      expect(res.statusCode).toBe(200);
      expect(mockBuildPublicQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ONRAMP",
          inputAmount: "10",
          inputSide: "to",
        })
      );
    });

    it("supports action=sell (offramp) and action=swap", async () => {
      mockBuildPublicQuote.mockResolvedValue({
        success: true,
        data: {
          quoteId: "q-sell",
          expiresAt: new Date().toISOString(),
          exchangeRate: "15.25",
          input: { amount: "100.00", currency: "USDC" },
          output: { amount: "1525.00", currency: "GHS", chain: "BASE" },
          fees: { networkFee: "0", platformFee: "1.00", totalFee: "1.00" },
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/quote?action=sell&amount=100&f_token=USDC&t_token=GHS&chain=BASE",
      });
      expect(res.statusCode).toBe(200);
      expect(mockBuildPublicQuote).toHaveBeenCalledWith(
        expect.objectContaining({ action: "OFFRAMP" })
      );

      mockBuildPublicQuote.mockResolvedValue({
        success: true,
        data: {
          quoteId: "q-swap",
          expiresAt: new Date().toISOString(),
          exchangeRate: "1.02",
          input: { amount: "100.00", currency: "USDC" },
          output: { amount: "98.04", currency: "USDT", chain: "BASE" },
          fees: { networkFee: "0", platformFee: "0.50", totalFee: "0.50" },
        },
      });
      const swapRes = await app.inject({
        method: "GET",
        url: "/api/quote?action=swap&amount=100&f_token=USDC&t_token=USDT&chain=BASE",
      });
      expect(swapRes.statusCode).toBe(200);
      expect(mockBuildPublicQuote).toHaveBeenCalledWith(
        expect.objectContaining({ action: "SWAP" })
      );
    });
  });

  describe("POST /api/quote/swap", () => {
    it("returns 400 when required body fields are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/swap",
        payload: { provider: "0x" },
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { error: string; details?: unknown };
      expect(json.error).toContain("Validation");
      expect(mockGetSwapQuote).not.toHaveBeenCalled();
    });

    it("returns 400 when provider is invalid", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/swap",
        payload: {
          provider: "invalid",
          from_token: "0xabc",
          to_token: "0xdef",
          amount: "1000000",
          from_chain: 1,
          to_chain: 1,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(mockGetSwapQuote).not.toHaveBeenCalled();
    });

    it("returns 400 when from_address missing for squid", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/swap",
        payload: {
          provider: "squid",
          from_token: "0xabc",
          to_token: "0xdef",
          amount: "1000000",
          from_chain: 1,
          to_chain: 137,
        },
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { error: string };
      expect(json.error).toContain("from_address");
      expect(mockGetSwapQuote).not.toHaveBeenCalled();
    });

    it("returns 503 when provider returns not configured", async () => {
      mockGetSwapQuote.mockResolvedValue({
        ok: false,
        error: "Squid integrator ID not configured (SQUID_INTEGRATOR_ID)",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/swap",
        payload: {
          provider: "squid",
          from_token: "0xabc",
          to_token: "0xdef",
          amount: "1000000",
          from_chain: 1,
          to_chain: 137,
          from_address: "0x1234567890123456789012345678901234567890",
        },
      });
      expect(res.statusCode).toBe(503);
      expect(mockGetSwapQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "squid",
          from_chain: 1,
          to_chain: 137,
          from_address: "0x1234567890123456789012345678901234567890",
        })
      );
    });

    it("returns 200 with normalized quote when provider succeeds", async () => {
      mockGetSwapQuote.mockResolvedValue({
        ok: true,
        quote: {
          provider: "0x",
          from_chain_id: 1,
          to_chain_id: 1,
          cross_chain: false,
          same_chain: true,
          token_type: "cross_token",
          from_amount: "1000000",
          to_amount: "2000000",
          next_quote_timer_seconds: null,
          estimated_duration_seconds: null,
          transaction: null,
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/swap",
        payload: {
          provider: "0x",
          from_token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          to_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          amount: "1000000",
          from_chain: 1,
          to_chain: 1,
        },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { provider: string; same_chain: boolean } };
      expect(json.success).toBe(true);
      expect(json.data.provider).toBe("0x");
      expect(json.data.same_chain).toBe(true);
    });
  });

  describe("POST /api/quote/best", () => {
    it("returns 400 when from_address missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/best",
        payload: {
          from_token: "0xabc",
          to_token: "0xdef",
          amount: "1000000",
          from_chain: 1,
          to_chain: 137,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(mockGetBestQuotes).not.toHaveBeenCalled();
    });

    it("returns 502 when getBestQuotes fails", async () => {
      mockGetBestQuotes.mockResolvedValue({
        ok: false,
        error: "All providers failed",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/best",
        payload: {
          from_token: "0xabc",
          to_token: "0xdef",
          amount: "1000000",
          from_chain: 1,
          to_chain: 137,
          from_address: "0x1234567890123456789012345678901234567890",
        },
      });
      expect(res.statusCode).toBe(502);
      const json = res.json() as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toBe("All providers failed");
    });

    it("returns 200 with best and optional alternative", async () => {
      const bestQuote = {
        provider: "squid" as const,
        from_chain_id: 1,
        to_chain_id: 137,
        cross_chain: true,
        same_chain: false,
        token_type: "cross_token" as const,
        from_amount: "1000000",
        to_amount: "2500000",
        next_quote_timer_seconds: null,
        estimated_duration_seconds: 95,
        transaction: null,
      };
      mockGetBestQuotes.mockResolvedValue({
        ok: true,
        data: { best: bestQuote },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/quote/best",
        payload: {
          from_token: "0xabc",
          to_token: "0xdef",
          amount: "1000000",
          from_chain: 1,
          to_chain: 137,
          from_address: "0x1234567890123456789012345678901234567890",
        },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { best: { provider: string; to_amount: string } } };
      expect(json.success).toBe(true);
      expect(json.data.best.provider).toBe("squid");
      expect(json.data.best.to_amount).toBe("2500000");
      expect(mockGetBestQuotes).toHaveBeenCalledWith(
        expect.objectContaining({
          from_chain: 1,
          to_chain: 137,
          from_address: "0x1234567890123456789012345678901234567890",
        })
      );
    });
  });
});
