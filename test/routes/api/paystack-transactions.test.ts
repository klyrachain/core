import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackTransactionsApiRoutes } from "../../../src/routes/api/paystack-transactions.js";
import * as paystackService from "../../../src/services/paystack.service.js";
import * as paystackPaymentRecordService from "../../../src/services/paystack-payment-record.service.js";
import * as commerceSettlement from "../../../src/services/commerce-paystack-settlement.service.js";
import * as prismaMod from "../../../src/lib/prisma.js";

vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../src/lib/admin-auth.guard.js", () => ({
  requirePermission: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../src/services/commerce-paystack-settlement.service.js", () => ({
  settleCommercePaystackTransaction: vi.fn().mockResolvedValue({
    updatedCount: 0,
    notApplicable: true,
  }),
}));

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
const mockSettleCommerce = vi.mocked(commerceSettlement.settleCommercePaystackTransaction);
const mockTxFindUnique = vi.mocked(prismaMod.prisma.transaction.findUnique);

describe("Paystack transactions API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockTxFindUnique.mockResolvedValue(null);
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
      expect(mockSettleCommerce).not.toHaveBeenCalled();
    });

    it("calls commerce settlement when verify succeeds with transaction_id metadata", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockUpsertRecord.mockResolvedValue(undefined);
      mockSettleCommerce.mockResolvedValueOnce({ updatedCount: 1, notApplicable: false });
      mockVerify.mockResolvedValue({
        id: 1,
        status: "success",
        reference: "ref_com",
        amount: 50000,
        currency: "NGN",
        metadata: { transaction_id: "tx-commerce-1", payer_email: "buyer@test.com" },
      } as any);
      let findCall = 0;
      mockTxFindUnique.mockImplementation(async (args: { select?: unknown; include?: unknown }) => {
        findCall += 1;
        if (findCall === 1) {
          return {
            id: "tx-commerce-1",
            type: "BUY",
            paymentLinkId: "pl-1",
            status: "COMPLETED",
            paymentConfirmedAt: new Date(),
          } as any;
        }
        if (args?.select) {
          return {
            id: "tx-commerce-1",
            status: "COMPLETED",
            paymentConfirmedAt: new Date(),
            cryptoSendTxHash: null,
          } as any;
        }
        return {
          id: "tx-commerce-1",
          status: "COMPLETED",
          business: { name: "Shop" },
          paymentLink: {
            publicCode: "ABC",
            amount: 500,
            currency: "NGN",
            chargeKind: "FIAT",
          },
        } as any;
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/transactions/verify/ref_com",
      });
      expect(res.statusCode).toBe(200);
      expect(mockSettleCommerce).toHaveBeenCalledWith({
        transactionId: "tx-commerce-1",
        reference: "ref_com",
        payerEmail: "buyer@test.com",
      });
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
