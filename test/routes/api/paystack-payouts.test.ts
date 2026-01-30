import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackPayoutsApiRoutes } from "../../../src/routes/api/paystack-payouts.js";
import * as paystackService from "../../../src/services/paystack.service.js";
import * as prisma from "../../../src/lib/prisma.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  createTransferRecipient: vi.fn(),
  initiateTransfer: vi.fn(),
  verifyTransfer: vi.fn(),
  isPaystackConfigured: vi.fn(),
}));
vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: { findUnique: vi.fn() },
    payoutRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    paystackTransferRecord: { create: vi.fn() },
  },
}));

const mockIsPaystackConfigured = vi.mocked(paystackService.isPaystackConfigured);
const mockCreateRecipient = vi.mocked(paystackService.createTransferRecipient);
const mockInitiateTransfer = vi.mocked(paystackService.initiateTransfer);
const mockVerifyTransfer = vi.mocked(paystackService.verifyTransfer);
const mockTxFindUnique = vi.mocked(prisma.prisma.transaction.findUnique);
const mockPayoutFindUnique = vi.mocked(prisma.prisma.payoutRequest.findUnique);
const mockPayoutFindFirst = vi.mocked(prisma.prisma.payoutRequest.findFirst);
const mockPayoutFindMany = vi.mocked(prisma.prisma.payoutRequest.findMany);
const mockPayoutCount = vi.mocked(prisma.prisma.payoutRequest.count);
const mockPayoutCreate = vi.mocked(prisma.prisma.payoutRequest.create);
const mockPayoutUpdate = vi.mocked(prisma.prisma.payoutRequest.update);

describe("Paystack payouts API", () => {
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
    await app.register(paystackPayoutsApiRoutes, { prefix: "" });
  });

  describe("POST /api/paystack/payouts/request", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);
      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payouts/request",
        payload: { transaction_id: "00000000-0000-0000-0000-000000000001" },
      });
      expect(res.statusCode).toBe(503);
    });

    it("returns 404 when transaction not found", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockTxFindUnique.mockResolvedValue(null);
      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payouts/request",
        payload: { transaction_id: "00000000-0000-0000-0000-000000000001" },
      });
      expect(res.statusCode).toBe(404);
    });

    const TX_UUID = "00000000-0000-0000-0000-000000000001";

    it("returns 400 when transaction not COMPLETED", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockTxFindUnique.mockResolvedValue({ id: TX_UUID, status: "PENDING" } as any);
      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payouts/request",
        payload: { transaction_id: TX_UUID },
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { error: string };
      expect(json.error).toContain("COMPLETED");
    });

    it("returns 201 with code when transaction is COMPLETED", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockTxFindUnique.mockResolvedValue({ id: TX_UUID, status: "COMPLETED" } as any);
      mockPayoutFindFirst.mockResolvedValue(null);
      mockPayoutCreate.mockResolvedValue({
        id: "pr-1",
        code: "abc123xyz",
        transactionId: TX_UUID,
        status: "pending",
        amount: null,
        currency: null,
        recipientCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payouts/request",
        payload: { transaction_id: TX_UUID },
      });
      expect(res.statusCode).toBe(201);
      const json = res.json() as { success: boolean; data: { code: string; payout_request_id: string } };
      expect(json.data.code).toBe("abc123xyz");
      expect(json.data.payout_request_id).toBe("pr-1");
    });
  });

  describe("GET /api/paystack/payouts/:code", () => {
    it("returns 404 when code not found", async () => {
      mockPayoutFindUnique.mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/api/paystack/payouts/unknown" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 200 with payout and transaction summary", async () => {
      mockPayoutFindUnique.mockResolvedValue({
        id: "pr-1",
        code: "abc123",
        transactionId: "tx-1",
        status: "pending",
        amount: null,
        currency: null,
        recipientCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        transaction: {
          id: "tx-1",
          type: "BUY",
          status: "COMPLETED",
          f_amount: 100,
          t_amount: 1,
          f_token: "NGN",
          t_token: "USDC",
          fromIdentifier: "a@b.com",
          toIdentifier: "0x123",
        },
      } as any);
      const res = await app.inject({ method: "GET", url: "/api/paystack/payouts/abc123" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { code: string; transaction: unknown } };
      expect(json.data.code).toBe("abc123");
      expect(json.data.transaction).toBeDefined();
    });
  });

  describe("POST /api/paystack/payouts/execute", () => {
    it("returns 404 when payout code not found", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockPayoutFindUnique.mockResolvedValue(null);
      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payouts/execute",
        payload: {
          code: "bad",
          amount: 10000,
          currency: "NGN",
          recipient_type: "nuban",
          name: "John",
          account_number: "0123456789",
          bank_code: "044",
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 200 and calls createTransferRecipient and initiateTransfer when valid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockPayoutFindUnique.mockResolvedValue({
        id: "pr-1",
        code: "abc123",
        transactionId: "tx-1",
        status: "pending",
        transaction: {},
      } as any);
      mockCreateRecipient.mockResolvedValue({ recipient_code: "RCP_xxx" });
      mockInitiateTransfer.mockResolvedValue({
        transfer_code: "TRF_xxx",
        status: "success",
        reference: "payout_pr-1_1",
      });
      mockPayoutUpdate.mockResolvedValue({} as any);
      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payouts/execute",
        payload: {
          code: "abc123",
          amount: 10000,
          currency: "NGN",
          recipient_type: "nuban",
          name: "John",
          account_number: "0123456789",
          bank_code: "044",
        },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as {
        success: boolean;
        data: { transfer_code: string; status: string; recipient?: { name: string; type: string } };
      };
      expect(json.data.transfer_code).toBe("TRF_xxx");
      expect(json.data.status).toBe("success");
      expect(json.data.success).toBe(true);
      expect(json.data.recipient).toEqual({ name: "John", type: "nuban" });
      expect(mockCreateRecipient).toHaveBeenCalled();
      expect(mockInitiateTransfer).toHaveBeenCalled();
    });
  });

  describe("GET /api/paystack/payouts/verify/:reference", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/payouts/verify/ref_abc",
      });
      expect(res.statusCode).toBe(503);
      expect(mockVerifyTransfer).not.toHaveBeenCalled();
    });

    it("returns 400 when reference missing", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/payouts/verify/%20",
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 200 with transfer data and success when verified", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockVerifyTransfer.mockResolvedValue({
        id: 476948,
        reference: "ref_abc",
        transfer_code: "TRF_xxx",
        amount: 50000,
        currency: "NGN",
        status: "success",
        reason: "Payout",
        created_at: "2018-07-22T10:29:33.000Z",
        updated_at: "2018-07-22T10:30:33.000Z",
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/payouts/verify/ref_abc",
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { status: string; success: boolean; reference: string } };
      expect(json.data.status).toBe("success");
      expect(json.data.success).toBe(true);
      expect(json.data.reference).toBe("ref_abc");
      expect(mockVerifyTransfer).toHaveBeenCalledWith("ref_abc");
    });
  });

  describe("GET /api/paystack/payouts/history", () => {
    it("returns 503 when Paystack not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);
      const res = await app.inject({ method: "GET", url: "/api/paystack/payouts/history" });
      expect(res.statusCode).toBe(503);
    });

    it("returns 200 with payouts and meta from DB", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockPayoutFindMany.mockResolvedValue([
        {
          id: "pr-1",
          code: "abc",
          status: "completed",
          amount: 10000n,
          currency: "NGN",
          recipientName: "Jane",
          recipientType: "nuban",
          transferCode: "TRF_1",
          transferReference: "ref_1",
          transactionId: "tx-1",
          transaction: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);
      mockPayoutCount.mockResolvedValue(1);
      const res = await app.inject({ method: "GET", url: "/api/paystack/payouts/history?perPage=10&page=1" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { payouts: unknown[]; meta: unknown } };
      expect(json.data.payouts).toHaveLength(1);
      expect(json.data.meta).toBeDefined();
    });
  });
});
