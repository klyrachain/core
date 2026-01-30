import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackTransfersApiRoutes } from "../../../src/routes/api/paystack-transfers.js";
import * as paystackService from "../../../src/services/paystack.service.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  listTransfers: vi.fn(),
  isPaystackConfigured: vi.fn(),
}));

const mockListTransfers = vi.mocked(paystackService.listTransfers);
const mockIsConfigured = vi.mocked(paystackService.isPaystackConfigured);

describe("Paystack transfers API", () => {
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
    await app.register(paystackTransfersApiRoutes, { prefix: "" });
  });

  describe("GET /api/paystack/transfers", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsConfigured.mockReturnValue(false);
      const res = await app.inject({ method: "GET", url: "/api/paystack/transfers" });
      expect(res.statusCode).toBe(503);
      expect(mockListTransfers).not.toHaveBeenCalled();
    });

    it("returns 200 with transfers and meta from Paystack", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockListTransfers.mockResolvedValue({
        data: [
          {
            id: 1,
            reference: "ref_1",
            transfer_code: "TRF_xxx",
            amount: 10000,
            currency: "NGN",
            status: "success",
            reason: "Payout",
            created_at: "2025-01-30T12:00:00.000Z",
            updated_at: "2025-01-30T12:00:00.000Z",
          },
        ],
        meta: { total: 1, skipped: 0, perPage: 50, page: 1, pageCount: 1 },
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/transfers?perPage=10&page=1",
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { transfers: unknown[]; meta: unknown } };
      expect(json.data.transfers).toHaveLength(1);
      expect(json.data.meta).toBeDefined();
      expect(mockListTransfers).toHaveBeenCalledWith(expect.objectContaining({ perPage: 10, page: 1 }));
    });
  });
});
