import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackWebhookRoutes } from "../../../src/routes/webhook/paystack.js";
import * as paystackService from "../../../src/services/paystack.service.js";
import * as prisma from "../../../src/lib/prisma.js";
import * as adminDashboard from "../../../src/services/admin-dashboard.service.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  verifyPaystackWebhookSignature: vi.fn(),
}));
vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("../../../src/services/admin-dashboard.service.js", () => ({
  sendToAdminDashboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/services/pusher.service.js", () => ({
  triggerTransactionStatusChange: vi.fn().mockResolvedValue(undefined),
}));

const mockVerify = vi.mocked(paystackService.verifyPaystackWebhookSignature);
const mockTxFindUnique = vi.mocked(prisma.prisma.transaction.findUnique);
const mockTxUpdate = vi.mocked(prisma.prisma.transaction.update);

describe("POST /webhook/paystack", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      (req as { rawBody?: string }).rawBody = typeof body === "string" ? body : "";
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    await app.register(paystackWebhookRoutes, { prefix: "" });
  });

  it("returns 401 when signature is invalid", async () => {
    const payload = { event: "charge.success", data: { reference: "ref_1", metadata: { transaction_id: "tx-1" } } };
    mockVerify.mockReturnValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/webhook/paystack",
      headers: { "x-paystack-signature": "bad" },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("returns 200 and updates transaction on charge.success", async () => {
    const payload = { event: "charge.success", data: { reference: "ref_1", metadata: { transaction_id: "tx-1" } } };
    mockVerify.mockReturnValue(true);
    mockTxFindUnique.mockResolvedValue({
      id: "tx-1",
      providerSessionId: "ref_1",
      type: "BUY",
      status: "PENDING",
    } as any);
    mockTxUpdate.mockResolvedValue({} as any);

    const res = await app.inject({
      method: "POST",
      url: "/webhook/paystack",
      headers: { "x-paystack-signature": "valid" },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith({
      where: { id: "tx-1" },
      data: { status: "COMPLETED" },
    });
  });

  it("returns 200 and sets FAILED on charge.failed", async () => {
    const payload = { event: "charge.failed", data: { reference: "ref_2", metadata: { transaction_id: "tx-2" } } };
    mockVerify.mockReturnValue(true);
    mockTxFindUnique.mockResolvedValue({
      id: "tx-2",
      providerSessionId: "ref_2",
      type: "BUY",
      status: "PENDING",
    } as any);
    mockTxUpdate.mockResolvedValue({} as any);

    const res = await app.inject({
      method: "POST",
      url: "/webhook/paystack",
      headers: { "x-paystack-signature": "valid" },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith({
      where: { id: "tx-2" },
      data: { status: "FAILED" },
    });
  });
});
