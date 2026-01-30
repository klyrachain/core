import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackTransactionsApiRoutes } from "../../../src/routes/api/paystack-transactions.js";
import * as paystackService from "../../../src/services/paystack.service.js";
import * as paystackPaymentRecordService from "../../../src/services/paystack-payment-record.service.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  verifyTransaction: vi.fn(),
  getTransactionById: vi.fn(),
  listTransactions: vi.fn(),
  isPaystackConfigured: vi.fn(),
  sanitizeTransactionData: (data: unknown) => data,
}));

vi.mock("../../../src/services/paystack-payment-record.service.js", () => ({
  upsertPaystackPaymentRecord: vi.fn(),
}));

const mockVerify = vi.mocked(paystackService.verifyTransaction);
const mockUpsertRecord = vi.mocked(paystackPaymentRecordService.upsertPaystackPaymentRecord);
const mockGetById = vi.mocked(paystackService.getTransactionById);
const mockList = vi.mocked(paystackService.listTransactions);
const mockIsConfigured = vi.mocked(paystackService.isPaystackConfigured);

describe("Paystack transactions API", () => {
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
    await app.register(paystackTransactionsApiRoutes, { prefix: "" });
  });

  describe("GET /api/paystack/transactions/verify/:reference", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsConfigured.mockReturnValue(false);
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/transactions/verify/ref_abc",
      });
      expect(res.statusCode).toBe(503);
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("returns 200 with transaction data when verified", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockUpsertRecord.mockResolvedValue(undefined);
      mockVerify.mockResolvedValue({
        id: 4099260516,
        status: "success",
        reference: "ref_abc",
        amount: 40333,
        currency: "NGN",
        paid_at: "2024-08-22T09:15:02.000Z",
        created_at: "2024-08-22T09:14:24.000Z",
        channel: "card",
        gateway_response: "Successful",
        message: null,
        customer: { id: 1, email: "demo@test.com", customer_code: "CUS_xxx" },
      } as any);
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/transactions/verify/ref_abc",
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { status: string; reference: string } };
      expect(json.data.status).toBe("success");
      expect(json.data.reference).toBe("ref_abc");
      expect(mockVerify).toHaveBeenCalledWith("ref_abc");
      expect(mockUpsertRecord).toHaveBeenCalledWith(
        expect.objectContaining({ reference: "ref_abc", status: "success" }),
        null
      );
    });
  });

  describe("GET /api/paystack/transactions/:id", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsConfigured.mockReturnValue(false);
      const res = await app.inject({ method: "GET", url: "/api/paystack/transactions/4099260516" });
      expect(res.statusCode).toBe(503);
    });

    it("returns 400 when id is not a positive integer", async () => {
      mockIsConfigured.mockReturnValue(true);
      const res = await app.inject({ method: "GET", url: "/api/paystack/transactions/abc" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 200 with transaction when id valid", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockGetById.mockResolvedValue({
        id: 4099260516,
        status: "success",
        reference: "ref_xyz",
        amount: 20000,
        currency: "NGN",
      } as any);
      const res = await app.inject({ method: "GET", url: "/api/paystack/transactions/4099260516" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { id: number } };
      expect(json.data.id).toBe(4099260516);
      expect(mockGetById).toHaveBeenCalledWith(4099260516);
    });
  });

  describe("GET /api/paystack/transactions", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsConfigured.mockReturnValue(false);
      const res = await app.inject({ method: "GET", url: "/api/paystack/transactions" });
      expect(res.statusCode).toBe(503);
    });

    it("returns 200 with transactions and meta", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockList.mockResolvedValue({
        data: [{ id: 1, status: "success", reference: "r1", amount: 100, currency: "NGN" } as any],
        meta: { total: 1, perPage: 50, page: 1 },
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/transactions?perPage=10&page=1&status=success",
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { transactions: unknown[]; meta: unknown } };
      expect(json.data.transactions).toHaveLength(1);
      expect(json.data.meta).toBeDefined();
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ perPage: 10, page: 1, status: "success" })
      );
    });
  });
});
