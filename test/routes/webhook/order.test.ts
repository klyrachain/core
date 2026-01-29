import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { orderWebhookRoutes } from "../../../src/routes/webhook/order.js";

const mockCreate = vi.fn();
const mockAddPollJob = vi.fn();
const mockSendToAdminDashboard = vi.fn();

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

const validBody = {
  action: "buy",
  fromIdentifier: "alice@example.com",
  fromType: "EMAIL",
  toIdentifier: "0xabc",
  toType: "ADDRESS",
  f_amount: 100,
  t_amount: 0.05,
  f_price: 2000,
  t_price: 2000,
  f_token: "USDC",
  t_token: "ETH",
};

describe("webhook order", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    mockCreate.mockReset();
    mockAddPollJob.mockReset();
    mockSendToAdminDashboard.mockReset();
    mockSendToAdminDashboard.mockResolvedValue(undefined);
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
    it("should return 400 when body fails validation (invalid action)", async () => {
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
    });

    it("should return 400 when required fields are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: { action: "buy" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { success: boolean }).success).toBe(false);
      expect(mockCreate).not.toHaveBeenCalled();
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
            f_amount: 100,
            t_amount: 0.05,
            f_token: "USDC",
            t_token: "ETH",
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

    it("should return 500 when prisma.transaction.create throws", async () => {
      mockCreate.mockRejectedValue(new Error("DB error"));

      const res = await app.inject({
        method: "POST",
        url: "/webhook/order",
        payload: validBody,
        headers: { "content-type": "application/json" },
      });

      expect(res.statusCode).toBe(500);
      expect((res.json() as { success: boolean; error: string }).error).toBe("Something went wrong.");
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
            f_price: 2000,
            t_price: 2000,
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
      expect(call.data.feeAmount).toBe(1); // 1% of 100
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
      expect(call.data.feeAmount).toBe(2); // 1% of 200
      expect(call.data.profit).toBe(2);
    });
  });
});
