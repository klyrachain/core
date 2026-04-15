import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackMobileApiRoutes } from "../../../src/routes/api/paystack-mobile.js";
import * as paystackService from "../../../src/services/paystack.service.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  listMobileMoneyProviders: vi.fn(),
  isPaystackConfigured: vi.fn(),
}));

const mockListMobileMoneyProviders = vi.mocked(paystackService.listMobileMoneyProviders);
const mockIsPaystackConfigured = vi.mocked(paystackService.isPaystackConfigured);

describe("Paystack mobile API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("preHandler", (req, _reply, done) => {
      (req as { apiKey?: { id: string; name: string; permissions: string[]; businessId: string | null } }).apiKey = {
        id: "test-key",
        name: "Test",
        permissions: ["*"],
        businessId: null,
      };
      done();
    });
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    await app.register(paystackMobileApiRoutes, { prefix: "" });
  });

  describe("GET /api/paystack/mobile/providers", () => {
    it("returns 503 when Paystack is not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/mobile/providers?currency=GHS",
      });

      expect(res.statusCode).toBe(503);
      const json = res.json() as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toContain("Paystack");
      expect(mockListMobileMoneyProviders).not.toHaveBeenCalled();
    });

    it("returns 400 when currency is missing or invalid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/mobile/providers",
      });

      expect(res.statusCode).toBe(400);
      expect(mockListMobileMoneyProviders).not.toHaveBeenCalled();
    });

    it("returns 400 when currency is not GHS or KES", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/mobile/providers?currency=NGN",
      });

      expect(res.statusCode).toBe(400);
      expect(mockListMobileMoneyProviders).not.toHaveBeenCalled();
    });

    it("returns 200 with providers when configured and currency valid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockListMobileMoneyProviders.mockResolvedValue({
        data: [
          { id: 1, name: "MTN", code: "MTN", slug: "mtn", country: "Ghana", currency: "GHS", type: "mobile_money" },
        ],
        meta: { perPage: 50 },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/mobile/providers?currency=GHS",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { providers: unknown[]; meta?: unknown } };
      expect(json.success).toBe(true);
      expect(json.data.providers).toHaveLength(1);
      expect(json.data.providers[0]).toMatchObject({ name: "MTN", code: "MTN", type: "mobile_money" });
      expect(mockListMobileMoneyProviders).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "GHS" })
      );
    });

    it("accepts KES for Kenya", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockListMobileMoneyProviders.mockResolvedValue({ data: [], meta: {} });

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/mobile/providers?currency=KES",
      });

      expect(res.statusCode).toBe(200);
      expect(mockListMobileMoneyProviders).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "KES" })
      );
    });
  });
});
