import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileStaleCommercePaystackTransactions } from "../../src/services/paystack-reconcile.service.js";
import * as paystackService from "../../src/services/paystack.service.js";
import * as commerceSettlement from "../../src/services/commerce-paystack-settlement.service.js";
import * as prismaMod from "../../src/lib/prisma.js";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../../src/services/paystack.service.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/paystack.service.js")>(
    "../../src/services/paystack.service.js"
  );
  return {
    ...actual,
    verifyTransaction: vi.fn(),
    isPaystackConfigured: vi.fn(),
  };
});

vi.mock("../../src/services/commerce-paystack-settlement.service.js", () => ({
  settleCommercePaystackTransaction: vi.fn(),
}));

const mockFindMany = vi.mocked(prismaMod.prisma.transaction.findMany);
const mockUpdateMany = vi.mocked(prismaMod.prisma.transaction.updateMany);
const mockVerify = vi.mocked(paystackService.verifyTransaction);
const mockIsConfigured = vi.mocked(paystackService.isPaystackConfigured);
const mockSettle = vi.mocked(commerceSettlement.settleCommercePaystackTransaction);

describe("reconcileStaleCommercePaystackTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    mockFindMany.mockResolvedValue([]);
  });

  it("no-ops when Paystack not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    const r = await reconcileStaleCommercePaystackTransactions({
      minAgeMs: 60_000,
      maxBatch: 10,
    });
    expect(r.processed).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("settles when verify returns success", async () => {
    mockFindMany.mockResolvedValue([
      { id: "tx-1", providerSessionId: "ref_a" },
    ] as never);
    mockVerify.mockResolvedValue({
      status: "success",
      reference: "ref_a",
      metadata: { payer_email: "p@x.com" },
    } as never);
    mockSettle.mockResolvedValue({ updatedCount: 1, notApplicable: false });

    const r = await reconcileStaleCommercePaystackTransactions({
      minAgeMs: 60_000,
      maxBatch: 10,
    });

    expect(mockVerify).toHaveBeenCalledWith("ref_a");
    expect(mockSettle).toHaveBeenCalledWith({
      transactionId: "tx-1",
      reference: "ref_a",
      payerEmail: "p@x.com",
    });
    expect(r.settled).toBe(1);
  });

  it("marks FAILED when verify returns failed", async () => {
    mockFindMany.mockResolvedValue([
      { id: "tx-2", providerSessionId: "ref_b" },
    ] as never);
    mockVerify.mockResolvedValue({ status: "failed" } as never);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const r = await reconcileStaleCommercePaystackTransactions({
      minAgeMs: 60_000,
      maxBatch: 10,
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "tx-2", status: "PENDING", providerSessionId: "ref_b" },
      data: { status: "FAILED" },
    });
    expect(r.failedMarked).toBe(1);
  });

  it("counts still pending for unknown Paystack status", async () => {
    mockFindMany.mockResolvedValue([
      { id: "tx-3", providerSessionId: "ref_c" },
    ] as never);
    mockVerify.mockResolvedValue({ status: "ongoing" } as never);

    const r = await reconcileStaleCommercePaystackTransactions({
      minAgeMs: 60_000,
      maxBatch: 10,
    });
    expect(r.stillPending).toBe(1);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("increments errors when verify throws", async () => {
    mockFindMany.mockResolvedValue([
      { id: "tx-4", providerSessionId: "ref_d" },
    ] as never);
    mockVerify.mockRejectedValue(new Error("network"));

    const r = await reconcileStaleCommercePaystackTransactions({
      minAgeMs: 60_000,
      maxBatch: 10,
    });
    expect(r.errors).toBe(1);
  });
});
