import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackPaymentsApiRoutes } from "../../../src/routes/api/paystack-payments.js";
import * as paystackService from "../../../src/services/paystack.service.js";
import * as prisma from "../../../src/lib/prisma.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  initializePayment: vi.fn(),
  isPaystackConfigured: vi.fn(),
}));
vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockInitializePayment = vi.mocked(paystackService.initializePayment);
const mockIsPaystackConfigured = vi.mocked(paystackService.isPaystackConfigured);
const mockTxCreate = vi.mocked(prisma.prisma.transaction.create);
const mockTxFindUnique = vi.mocked(prisma.prisma.transaction.findUnique);
const mockTxUpdate = vi.mocked(prisma.prisma.transaction.update);

describe("Paystack payments API", () => {
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
    await app.register(paystackPaymentsApiRoutes, { prefix: "" });
  });

  describe("POST /api/paystack/payments/initialize", () => {
    it("returns 503 when Paystack is not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);

      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payments/initialize",
        payload: { email: "a@b.com", amount: 10000 },
      });

      expect(res.statusCode).toBe(503);
      expect(mockInitializePayment).not.toHaveBeenCalled();
    });

    it("returns 400 when body is invalid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);

      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payments/initialize",
        payload: { email: "invalid", amount: -1 },
      });

      expect(res.statusCode).toBe(400);
      expect(mockInitializePayment).not.toHaveBeenCalled();
    });

    it("returns 201 with authorization_url when configured and creates transaction", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockTxCreate.mockResolvedValue({
        id: "tx-123",
        createdAt: new Date(),
        updatedAt: new Date(),
        type: "BUY",
        status: "PENDING",
        fromIdentifier: "a@b.com",
        fromType: "EMAIL",
        fromUserId: null,
        toIdentifier: null,
        toType: null,
        toUserId: null,
        f_amount: 100,
        t_amount: 0,
        exchangeRate: 1,
        f_tokenPriceUsd: 1,
        t_tokenPriceUsd: 1,
        f_chain: "ETHEREUM",
        t_chain: "ETHEREUM",
        f_token: "NGN",
        t_token: "USDC",
        f_provider: "PAYSTACK",
        t_provider: "NONE",
        providerSessionId: null,
        requestId: null,
      } as any);
      mockTxUpdate.mockResolvedValue({} as any);
      mockInitializePayment.mockResolvedValue({
        authorization_url: "https://checkout.paystack.com/xxx",
        access_code: "acc_xxx",
        reference: "ref_xxx",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/payments/initialize",
        payload: { email: "a@b.com", amount: 10000 },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json() as { success: boolean; data: { authorization_url: string; reference: string; transaction_id: string } };
      expect(json.success).toBe(true);
      expect(json.data.authorization_url).toBe("https://checkout.paystack.com/xxx");
      expect(json.data.reference).toBe("ref_xxx");
      expect(json.data.transaction_id).toBe("tx-123");
      expect(mockInitializePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "a@b.com",
          amount: 10000,
          currency: "NGN",
          metadata: expect.objectContaining({ transaction_id: "tx-123" }),
        })
      );
    });
  });
});
