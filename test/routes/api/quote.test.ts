import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { quoteApiRoutes } from "../../../src/routes/api/quote.js";
import * as swapQuoteService from "../../../src/services/swap-quote.service.js";

vi.mock("../../../src/services/swap-quote.service.js", () => ({
  getSwapQuote: vi.fn(),
  getBestQuotes: vi.fn(),
}));

const mockGetSwapQuote = vi.mocked(swapQuoteService.getSwapQuote);
const mockGetBestQuotes = vi.mocked(swapQuoteService.getBestQuotes);

describe("Quote API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  describe("POST /api/quote/swap", () => {
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
