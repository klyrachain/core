import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackWebhookRoutes } from "../../../src/routes/webhook/paystack.js";
import * as paystackService from "../../../src/services/paystack.service.js";
import * as prisma from "../../../src/lib/prisma.js";
import { executeOnrampSend } from "../../../src/services/onramp-execution.service.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  verifyPaystackWebhookSignature: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentLink: {
      findUnique: vi.fn(),
    },
    business: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("../../../src/services/admin-dashboard.service.js", () => ({
  sendToAdminDashboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/services/pusher.service.js", () => ({
  triggerTransactionStatusChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/services/paystack-payment-record.service.js", () => ({
  upsertPaystackPaymentRecord: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/services/fee.service.js", () => ({
  computeTransactionFee: vi.fn().mockReturnValue(0),
}));
vi.mock("../../../src/services/onramp-execution.service.js", () => ({
  executeOnrampSend: vi.fn().mockResolvedValue({ ok: true, txHash: "0xabc" }),
}));
vi.mock("../../../src/services/request-settlement.service.js", () => ({
  onRequestPaymentSettled: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../../../src/services/notification.service.js", () => ({
  sendPaymentLinkPaystackSuccessEmails: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/config/env.js", () => ({
  getEnv: () => ({ PAYSTACK_PLATFORM_EMAIL: "platform@test.com" }),
}));

const mockVerify = vi.mocked(paystackService.verifyPaystackWebhookSignature);
const mockVerifyTx = vi.mocked(paystackService.verifyTransaction);
const mockTxFindUnique = vi.mocked(prisma.prisma.transaction.findUnique);
const mockTxUpdateMany = vi.mocked(prisma.prisma.transaction.updateMany);
const mockPaymentLinkFindUnique = vi.mocked(prisma.prisma.paymentLink.findUnique);
const mockExecuteOnrampSend = vi.mocked(executeOnrampSend);

describe("POST /webhook/paystack", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockVerifyTx.mockResolvedValue({} as never);
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
    expect(mockTxUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 200 and completes CRYPTO commerce link on charge.success without onramp send", async () => {
    const payload = {
      event: "charge.success",
      data: { reference: "ref_c", metadata: { transaction_id: "tx-c" } },
    };
    mockVerify.mockReturnValue(true);
    mockTxFindUnique.mockResolvedValue({
      id: "tx-c",
      providerSessionId: "ref_c",
      type: "BUY",
      status: "PENDING",
      paymentLinkId: "pl1",
      businessId: "b1",
      f_amount: 100,
      f_token: "GHS",
      fromIdentifier: "p@test.com",
    } as any);
    mockPaymentLinkFindUnique.mockResolvedValue({
      id: "pl1",
      chargeKind: "CRYPTO",
      title: "Link",
      publicCode: "PCODE",
      isOneTime: false,
    } as any);
    mockTxUpdateMany.mockResolvedValue({ count: 1 } as any);

    const res = await app.inject({
      method: "POST",
      url: "/webhook/paystack",
      headers: { "x-paystack-signature": "valid" },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockTxUpdateMany).toHaveBeenCalledWith({
      where: { id: "tx-c", status: "PENDING", providerSessionId: "ref_c" },
      data: expect.objectContaining({
        status: "COMPLETED",
        paymentConfirmedAt: expect.any(Date),
        fee: 0,
        platformFee: 0,
      }),
    });
    expect(mockExecuteOnrampSend).not.toHaveBeenCalled();
  });

  it("returns 200 and sets paymentConfirmedAt on charge.success for BUY onramp", async () => {
    const payload = { event: "charge.success", data: { reference: "ref_1", metadata: { transaction_id: "tx-1" } } };
    mockVerify.mockReturnValue(true);
    mockTxFindUnique.mockResolvedValue({
      id: "tx-1",
      providerSessionId: "ref_1",
      type: "BUY",
      status: "PENDING",
      paymentLinkId: null,
      businessId: null,
      f_amount: 100,
      f_token: "NGN",
      fromIdentifier: "payer@test.com",
    } as any);
    mockTxUpdateMany.mockResolvedValue({ count: 1 } as any);

    const res = await app.inject({
      method: "POST",
      url: "/webhook/paystack",
      headers: { "x-paystack-signature": "valid" },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockTxUpdateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "PENDING", paymentConfirmedAt: null },
      data: expect.objectContaining({ paymentConfirmedAt: expect.any(Date) }),
    });
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });

  it("returns 200 and sets FAILED on charge.failed", async () => {
    const payload = { event: "charge.failed", data: { reference: "ref_2", metadata: { transaction_id: "tx-2" } } };
    mockVerify.mockReturnValue(true);
    mockTxFindUnique.mockResolvedValue({
      id: "tx-2",
      providerSessionId: "ref_2",
      type: "BUY",
      status: "PENDING",
      paymentLinkId: null,
    } as any);
    mockTxUpdateMany.mockResolvedValue({ count: 1 } as any);

    const res = await app.inject({
      method: "POST",
      url: "/webhook/paystack",
      headers: { "x-paystack-signature": "valid" },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockTxUpdateMany).toHaveBeenCalledWith({
      where: { id: "tx-2" },
      data: { status: "FAILED" },
    });
  });
});
