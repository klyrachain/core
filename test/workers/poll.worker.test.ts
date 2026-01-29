import { describe, it, expect, beforeEach, vi } from "vitest";
import { processPollJob } from "../../src/workers/poll.worker.js";
import type { Job } from "bullmq";
import type { PollJobData } from "../../src/lib/queue.js";

const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    inventoryAsset: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

const mockDeductInventory = vi.fn();
const mockTriggerTransactionStatusChange = vi.fn();

vi.mock("../../src/services/inventory.service.js", () => ({
  deductInventory: (...args: unknown[]) => mockDeductInventory(...args),
}));

vi.mock("../../src/services/pusher.service.js", () => ({
  triggerTransactionStatusChange: (...args: unknown[]) =>
    mockTriggerTransactionStatusChange(...args),
}));

function createJob(transactionId: string): Job<PollJobData> {
  return { data: { transactionId }, id: transactionId } as Job<PollJobData>;
}

describe("poll.worker processPollJob", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindFirst.mockReset();
    mockUpdate.mockReset();
    mockDeductInventory.mockReset();
    mockTriggerTransactionStatusChange.mockReset();
  });

  it("should throw when transaction is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(processPollJob(createJob("missing-tx"))).rejects.toThrow(
      "Transaction not found: missing-tx"
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should return early when transaction status is not PENDING", async () => {
    mockFindUnique.mockResolvedValue({
      id: "tx-1",
      type: "BUY",
      status: "COMPLETED",
    });
    await processPollJob(createJob("tx-1"));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTriggerTransactionStatusChange).not.toHaveBeenCalled();
  });

  it("should complete BUY transaction and deduct inventory when asset exists", async () => {
    const tx = {
      id: "tx-1",
      type: "BUY",
      status: "PENDING",
      t_token: "USDC",
      t_amount: 10,
      t_price: 1,
    };
    mockFindUnique.mockResolvedValue(tx);
    mockFindFirst.mockResolvedValue({
      id: "asset-1",
      chain: "ETHEREUM",
      tokenAddress: "0xusdc",
      symbol: "USDC",
    });
    mockUpdate.mockResolvedValue({});
    mockDeductInventory.mockResolvedValue(undefined);
    mockTriggerTransactionStatusChange.mockResolvedValue(undefined);

    await processPollJob(createJob("tx-1"));

    expect(mockDeductInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "ETHEREUM",
        symbol: "USDC",
        amount: 10,
        type: "SALE",
        providerQuotePrice: 1,
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tx-1" },
      data: { status: "COMPLETED" },
    });
    expect(mockTriggerTransactionStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "tx-1",
        status: "COMPLETED",
        type: "BUY",
      })
    );
  });

  it("should complete non-BUY transaction without deducting inventory", async () => {
    const tx = {
      id: "tx-2",
      type: "SELL",
      status: "PENDING",
    };
    mockFindUnique.mockResolvedValue(tx);
    mockUpdate.mockResolvedValue({});

    await processPollJob(createJob("tx-2"));

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockDeductInventory).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tx-2" },
      data: { status: "COMPLETED" },
    });
    expect(mockTriggerTransactionStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-2", status: "COMPLETED", type: "SELL" })
    );
  });

  it("should set status to FAILED and rethrow when deductInventory throws", async () => {
    const tx = {
      id: "tx-3",
      type: "BUY",
      status: "PENDING",
      t_token: "USDC",
      t_amount: 10,
      t_price: 1,
    };
    mockFindUnique.mockResolvedValue(tx);
    mockFindFirst.mockResolvedValue({
      id: "asset-1",
      chain: "ETHEREUM",
      tokenAddress: "0xusdc",
      symbol: "USDC",
    });
    mockDeductInventory.mockRejectedValue(new Error("Insufficient inventory"));
    mockUpdate.mockResolvedValue({});

    await expect(processPollJob(createJob("tx-3"))).rejects.toThrow("Insufficient inventory");

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tx-3" },
      data: { status: "FAILED" },
    });
    expect(mockTriggerTransactionStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-3", status: "FAILED", type: "BUY" })
    );
  });

  it("should not deduct inventory when BUY but no asset found for symbol/chain", async () => {
    const tx = {
      id: "tx-4",
      type: "BUY",
      status: "PENDING",
      t_token: "UNKNOWN",
      t_amount: 1,
      t_price: 1,
    };
    mockFindUnique.mockResolvedValue(tx);
    mockFindFirst.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({});

    await processPollJob(createJob("tx-4"));

    expect(mockDeductInventory).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tx-4" },
      data: { status: "COMPLETED" },
    });
  });
});
