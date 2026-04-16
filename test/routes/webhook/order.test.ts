import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { orderWebhookRoutes } from "../../../src/routes/webhook/order.js";

const mockCreate = vi.fn();
const mockAddPollJob = vi.fn();
const mockSendToAdminDashboard = vi.fn();
const mockValidateOrder = vi.fn();
const mockStoreFailedValidation = vi.fn();

vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

vi.mock("../../../src/lib/queue.js", () => ({
  addPollJob: (...args: unknown[]) => mockAddPollJob(...args),
}));

vi.mock("../../../src/services/admin-dashboard.service.js", () => ({
  sendToAdminDashboard: (...args: unknown[]) => mockSendToAdminDashboard(...args),
}));

vi.mock("../../../src/services/order-validation.service.js", () => ({
  validateOrder: (...args: unknown[]) => mockValidateOrder(...args),
  storeFailedValidation: (...args: unknown[]) => mockStoreFailedValidation(...args),
}));

const validBody = {
  action: "buy",
  fromIdentifier: "alice@example.com",
  fromType: "EMAIL",
  toIdentifier: "0xabc",
  toType: "ADDRESS",
  f_amount: 100,
  t_amount: 0.05,
  f_chain: "ETHEREUM",
  t_chain: "ETHEREUM",
  f_token: "USDC",
  t_token: "ETH",
  f_provider: "KLYRA",
  t_provider: "KLYRA",
};

describe("webhook order", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    mockCreate.mockReset();
    mockAddPollJob.mockReset();
    mockSendToAdminDashboard.mockReset();
    mockValidateOrder.mockReset();
    mockStoreFailedValidation.mockReset();
    mockSendToAdminDashboard.mockResolvedValue(undefined);
    mockStoreFailedValidation.mockResolvedValue(undefined);
    mockValidateOrder.mockResolvedValue({ valid: true });
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    await app.register(orderWebhookRoutes, { prefix: "" });
  });

  describe("POST /webhook/order", () => {
    it("should return 400 and send order.rejected to admin when body fails validation (invalid action)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: { ...validBody, action: "invalid" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toBe("Validation failed");
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSendToAdminDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "order.rejected",
          data: expect.objectContaining({
            reason: "validation_failed",
            error: "Validation failed",
          }),
        })
      );
    });

    it("should return 400 and send order.rejected to admin when required fields are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: { action: "buy" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { success: boolean }).success).toBe(false);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSendToAdminDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "order.rejected",
          data: expect.objectContaining({ reason: "validation_failed" }),
        })
      );
    });

    it("should return 400 and send order.rejected when provider validation fails (e.g. PayStack requires toIdentifier)", async () => {
      mockValidateOrder.mockResolvedValueOnce({
        valid: false,
        error: "t_provider PAYSTACK requires toIdentifier (e.g. wallet address for Morapay, phone for PayStack)",
        code: "MISSING_TO_IDENTIFIER",
      });

      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: {
          ...validBody,
          t_provider: "PAYSTACK",
          toIdentifier: null,
          toType: null,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      const json = res.json() as { success: boolean; error: string; code?: string };
      expect(json.success).toBe(false);
      expect(json.error).toContain("toIdentifier");
      expect(json.code).toBe("MISSING_TO_IDENTIFIER");
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSendToAdminDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "order.rejected",
          data: expect.objectContaining({
            reason: "validation_failed",
            code: "MISSING_TO_IDENTIFIER",
          }),
        })
      );
    });

    it("should return 201 and create transaction and add poll job on valid payload", async () => {
      const tx = {
        id: "tx-123",
        type: "BUY",
        status: "PENDING",
      };
      mockCreate.mockResolvedValue(tx);
      mockAddPollJob.mockResolvedValue({ id: "tx-123" });

      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: validBody,
        headers: { "content-type": "application/json" },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json() as { success: boolean; data: { id: string; status: string; type: string } };
      expect(json.success).toBe(true);
      expect(json.data.id).toBe("tx-123");
      expect(json.data.status).toBe("PENDING");
      expect(json.data.type).toBe("BUY");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "BUY",
            status: "PENDING",
            f_chain: "ETHEREUM",
            t_chain: "ETHEREUM",
            f_amount: 100,
            t_amount: 0.05,
            f_token: "USDC",
            t_token: "ETH",
            exchangeRate: 0.0005,
            f_tokenPriceUsd: 1,
            t_tokenPriceUsd: 1,
          }),
        })
      );
      expect(mockAddPollJob).toHaveBeenCalledWith("tx-123");
    });

    it("should map action sell to TransactionType SELL", async () => {
      mockCreate.mockResolvedValue({ id: "tx-2", type: "SELL", status: "PENDING" });
      mockAddPollJob.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: { ...validBody, action: "sell" },
        headers: { "content-type": "application/json" },
      });

      expect(res.statusCode).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "SELL" }),
        })
      );
    });

    it("should return 500 and send order.rejected to admin when prisma.transaction.create throws", async () => {
      mockValidateOrder.mockResolvedValue({ valid: true });
      mockCreate.mockRejectedValue(new Error("DB error"));

      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: validBody,
        headers: { "content-type": "application/json" },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json() as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain("Something went wrong");
      expect(mockSendToAdminDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "order.rejected",
          data: expect.objectContaining({
            reason: "server_error",
            error: "DB error",
            action: "buy",
            f_chain: "ETHEREUM",
            t_chain: "ETHEREUM",
            f_token: "USDC",
            t_token: "ETH",
          }),
        })
      );
    });

    it("should send order.created to admin with prices, fee, totalCost and profit", async () => {
      mockCreate.mockResolvedValue({ id: "tx-admin", type: "BUY", status: "PENDING" });
      mockAddPollJob.mockResolvedValue({});

      await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: validBody,
        headers: { "content-type": "application/json" },
      });

      expect(mockSendToAdminDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "order.created",
          data: expect.objectContaining({
            transactionId: "tx-admin",
            action: "buy",
            status: "PENDING",
            f_amount: 100,
            t_amount: 0.05,
            exchangeRate: 0.0005,
            f_tokenPriceUsd: 1,
            t_tokenPriceUsd: 1,
            f_chain: "ETHEREUM",
            t_chain: "ETHEREUM",
            f_token: "USDC",
            t_token: "ETH",
          }),
        })
      );
      const call = mockSendToAdminDashboard.mock.calls[0][0];
      expect(call.data).toHaveProperty("feeAmount");
      expect(call.data).toHaveProperty("feePercent");
      expect(call.data).toHaveProperty("totalCost");
      expect(call.data).toHaveProperty("profit");
      expect(call.data.feeAmount).toBe(1);
      expect(call.data.totalCost).toBe(101);
      expect(call.data.profit).toBe(1);
    });

    it("should reflect correct fee and profit for sell (1% fee on f_amount)", async () => {
      mockCreate.mockResolvedValue({ id: "tx-2", type: "SELL", status: "PENDING" });
      mockAddPollJob.mockResolvedValue({});

      await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: { ...validBody, action: "sell", f_amount: 200 },
        headers: { "content-type": "application/json" },
      });

      const call = mockSendToAdminDashboard.mock.calls[0][0];
      expect(call.data.feeAmount).toBe(2);
      expect(call.data.profit).toBe(2);
    });

    it("accepts order without f_price/t_price (platform derives from amounts)", async () => {
      mockCreate.mockResolvedValue({ id: "tx-derived", type: "BUY", status: "PENDING" });
      mockAddPollJob.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: validBody,
        headers: { "content-type": "application/json" },
      });

      expect(res.statusCode).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "BUY",
            status: "PENDING",
            f_amount: 100,
            t_amount: 0.05,
            f_token: "USDC",
            t_token: "ETH",
            exchangeRate: 0.0005,
            f_tokenPriceUsd: 1,
            t_tokenPriceUsd: 1,
          }),
        })
      );
    });
  });
});
