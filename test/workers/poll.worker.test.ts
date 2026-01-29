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

const mockAddInventory = vi.fn();

vi.mock("../../src/services/inventory.service.js", () => ({
  deductInventory: (...args: unknown[]) => mockDeductInventory(...args),
  addInventory: (...args: unknown[]) => mockAddInventory(...args),
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
    mockAddInventory.mockReset();
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

  it("should complete BUY: deduct t_token and add f_token when assets exist", async () => {
    const tx = {
      id: "tx-1",
      type: "BUY",
      status: "PENDING",
      f_token: "USDC",
      f_amount: 1000,
      f_price: 1,
      t_token: "ETH",
      t_amount: 0.5,
      t_price: 3000,
    };
    mockFindUnique.mockResolvedValue(tx);
    const tAsset = { id: "asset-eth", chain: "ETHEREUM", tokenAddress: "0xeth", symbol: "ETH" };
    const fAsset = { id: "asset-usdc", chain: "ETHEREUM", tokenAddress: "0xusdc", symbol: "USDC" };
    mockFindFirst.mockResolvedValueOnce(tAsset).mockResolvedValueOnce(fAsset);
    mockUpdate.mockResolvedValue({});
    mockDeductInventory.mockResolvedValue(undefined);
    mockAddInventory.mockResolvedValue(undefined);
    mockTriggerTransactionStatusChange.mockResolvedValue(undefined);

    await processPollJob(createJob("tx-1"));

    expect(mockDeductInventory).toHaveBeenCalledTimes(1);
    expect(mockDeductInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "ETHEREUM",
        symbol: "ETH",
        amount: 0.5,
        type: "SALE",
        providerQuotePrice: 3000,
      })
    );
    expect(mockAddInventory).toHaveBeenCalledTimes(1);
    expect(mockAddInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "ETHEREUM",
        symbol: "USDC",
        amount: 1000,
        type: "PURCHASE",
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

  it("should complete SELL: add f_token and deduct t_token when assets exist", async () => {
    const tx = {
      id: "tx-2",
      type: "SELL",
      status: "PENDING",
      f_token: "ETH",
      f_amount: 0.5,
      f_price: 3000,
      t_token: "USDC",
      t_amount: 1500,
      t_price: 1,
    };
    mockFindUnique.mockResolvedValue(tx);
    const fAsset = { id: "asset-eth", chain: "ETHEREUM", tokenAddress: "0xeth", symbol: "ETH" };
    const tAsset = { id: "asset-usdc", chain: "ETHEREUM", tokenAddress: "0xusdc", symbol: "USDC" };
    mockFindFirst.mockResolvedValueOnce(fAsset).mockResolvedValueOnce(tAsset);
    mockUpdate.mockResolvedValue({});
    mockAddInventory.mockResolvedValue(undefined);
    mockDeductInventory.mockResolvedValue(undefined);
    mockTriggerTransactionStatusChange.mockResolvedValue(undefined);

    await processPollJob(createJob("tx-2"));

    expect(mockAddInventory).toHaveBeenCalledTimes(1);
    expect(mockAddInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        amount: 0.5,
        type: "PURCHASE",
      })
    );
    expect(mockDeductInventory).toHaveBeenCalledTimes(1);
    expect(mockDeductInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "USDC",
        amount: 1500,
        type: "SALE",
      })
    );
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
      f_token: "USDC",
      f_amount: 1000,
      f_price: 1,
      t_token: "ETH",
      t_amount: 10,
      t_price: 3000,
    };
    mockFindUnique.mockResolvedValue(tx);
    mockFindFirst.mockResolvedValueOnce({ id: "asset-eth", chain: "ETHEREUM", tokenAddress: "0xeth", symbol: "ETH" });
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

  it("should not deduct/add inventory when BUY but no assets found for symbol/chain", async () => {
    const tx = {
      id: "tx-4",
      type: "BUY",
      status: "PENDING",
      f_token: "X",
      t_token: "UNKNOWN",
      t_amount: 1,
      t_price: 1,
    };
    mockFindUnique.mockResolvedValue(tx);
    mockFindFirst.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({});

    await processPollJob(createJob("tx-4"));

    expect(mockDeductInventory).not.toHaveBeenCalled();
    expect(mockAddInventory).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "tx-4" },
      data: { status: "COMPLETED" },
    });
  });
});
