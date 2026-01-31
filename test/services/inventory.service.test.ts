import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  deductInventory,
  addInventory,
  getCachedBalance,
  refreshBalanceCache,
  getAverageCostBasis,
  getLotsForAsset,
} from "../../src/services/inventory.service.js";

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();
const mockTransaction = vi.fn();
const mockLotUpdate = vi.fn();

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    inventoryAsset: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findFirst: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    inventoryHistory: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
    inventoryLot: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockLotUpdate(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
    $transaction: (arg: unknown) => mockTransaction(arg),
  },
}));

const mockGetBalance = vi.fn();
const mockSetBalance = vi.fn();

vi.mock("../../src/lib/redis.js", () => ({
  getBalance: (...args: unknown[]) => mockGetBalance(...args),
  setBalance: (...args: unknown[]) => mockSetBalance(...args),
}));

describe("inventory.service", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindMany.mockReset();
    mockUpdate.mockReset();
    mockCreate.mockReset();
    mockLotUpdate.mockReset();
    mockTransaction.mockReset();
    mockGetBalance.mockReset();
    mockSetBalance.mockReset();
  });

  describe("deductInventory", () => {
    it("should throw when InventoryAsset is not found", async () => {
      mockFindUnique.mockResolvedValue(null);
      await expect(
        deductInventory({
          chain: "ETHEREUM",
          tokenAddress: "0xabc",
          symbol: "USDC",
          amount: 10,
          address: "0xwallet1",
        })
      ).rejects.toThrow("InventoryAsset not found");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should throw when balance is insufficient", async () => {
      mockFindUnique.mockResolvedValue({
        id: "asset-1",
        chain: "ETHEREUM",
        tokenAddress: "0xabc",
        symbol: "USDC",
        currentBalance: 5,
        lots: [],
      });
      await expect(
        deductInventory({
          chain: "ETHEREUM",
          tokenAddress: "0xabc",
          symbol: "USDC",
          amount: 10,
          address: "0xwallet1",
        })
      ).rejects.toThrow("Insufficient inventory");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should update asset, create history, and set Redis balance on success", async () => {
      const asset = {
        id: "asset-1",
        chain: "ETHEREUM",
        tokenAddress: "0xabc",
        symbol: "USDC",
        currentBalance: 100,
        lots: [],
      };
      mockFindUnique.mockResolvedValue(asset);
      mockUpdate.mockResolvedValue({});
      mockCreate.mockResolvedValue({});
      mockLotUpdate.mockResolvedValue({});
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          inventoryLot: { update: mockLotUpdate },
          inventoryAsset: { update: mockUpdate },
          inventoryHistory: { create: mockCreate },
        };
        return fn(tx);
      });

      const result = await deductInventory({
        chain: "ETHEREUM",
        tokenAddress: "0xabc",
        symbol: "USDC",
        amount: 20,
        address: "0xwallet1",
        type: "SALE",
        providerQuotePrice: 1.5,
      });

      expect(result.averageCostPerToken).toBeNull();
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "asset-1" },
          data: { currentBalance: expect.anything() },
        })
      );
      expect(mockSetBalance).toHaveBeenCalledWith(
        "ETHEREUM",
        "USDC",
        expect.objectContaining({
          amount: "80",
          status: "updated",
        })
      );
    });
  });

  describe("addInventory", () => {
    it("should throw when InventoryAsset is not found", async () => {
      mockFindUnique.mockResolvedValue(null);
      await expect(
        addInventory({
          chain: "ETHEREUM",
          tokenAddress: "0xeth",
          symbol: "ETH",
          amount: 1,
          address: "0xwallet1",
        })
      ).rejects.toThrow("InventoryAsset not found");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should update asset, create history, and set Redis balance on success", async () => {
      const asset = {
        id: "asset-eth",
        chain: "ETHEREUM",
        tokenAddress: "0xeth",
        symbol: "ETH",
        currentBalance: 10,
      };
      mockFindUnique.mockResolvedValue(asset);
      mockUpdate.mockResolvedValue({});
      mockCreate.mockResolvedValue({});
      mockTransaction.mockImplementation((promises: Promise<unknown>[]) => Promise.all(promises));

      await addInventory({
        chain: "ETHEREUM",
        tokenAddress: "0xeth",
        symbol: "ETH",
        amount: 2,
        address: "0xwallet1",
        type: "PURCHASE",
        providerQuotePrice: 3000,
      });

      expect(mockTransaction).toHaveBeenCalledWith([
        expect.any(Promise),
        expect.any(Promise),
        expect.any(Promise),
      ]);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "asset-eth" },
          data: { currentBalance: expect.anything() },
        })
      );
      expect(mockSetBalance).toHaveBeenCalledWith(
        "ETHEREUM",
        "ETH",
        expect.objectContaining({
          amount: "12",
          status: "updated",
        })
      );
    });
  });

  describe("getCachedBalance", () => {
    it("should return result from getBalance", async () => {
      const entry = { amount: "100", status: "synced", updatedAt: "2025-01-01T00:00:00Z" };
      mockGetBalance.mockResolvedValue(entry);
      const result = await getCachedBalance("ETHEREUM", "USDC");
      expect(result).toEqual(entry);
      expect(mockGetBalance).toHaveBeenCalledWith("ETHEREUM", "USDC");
    });

    it("should return null when getBalance returns null", async () => {
      mockGetBalance.mockResolvedValue(null);
      const result = await getCachedBalance("BASE", "ETH");
      expect(result).toBeNull();
    });
  });

  describe("refreshBalanceCache", () => {
    it("should do nothing when asset is not found", async () => {
      mockFindUnique.mockResolvedValue(null);
      await refreshBalanceCache("ETHEREUM", "0xmissing");
      expect(mockSetBalance).not.toHaveBeenCalled();
    });

    it("should set balance in Redis when asset exists (findFirst, no address)", async () => {
      mockFindUnique.mockResolvedValue({
        id: "asset-1",
        chain: "ETHEREUM",
        symbol: "USDC",
        currentBalance: 500,
      });
      mockSetBalance.mockResolvedValue(undefined);
      await refreshBalanceCache("ETHEREUM", "0xabc");
      expect(mockSetBalance).toHaveBeenCalledWith(
        "ETHEREUM",
        "USDC",
        expect.objectContaining({ amount: "500", status: "synced" })
      );
    });
  });

  describe("getAverageCostBasis", () => {
    it("should return null when no lots", async () => {
      mockFindMany.mockResolvedValue([]);
      const result = await getAverageCostBasis("asset-1");
      expect(result).toBeNull();
    });

    it("should return volume-weighted average when lots exist", async () => {
      mockFindMany.mockResolvedValue([
        { quantity: 10, costPerToken: 1 },
        { quantity: 20, costPerToken: 2 },
      ]);
      const result = await getAverageCostBasis("asset-1");
      expect(result).not.toBeNull();
      expect(Number(result!.toString())).toBeCloseTo((10 * 1 + 20 * 2) / 30);
    });
  });

  describe("getLotsForAsset", () => {
    it("should return lots in FIFO order", async () => {
      const lots = [
        { id: "l1", quantity: 5, costPerToken: 1, acquiredAt: new Date(), sourceType: "PURCHASE", sourceTransactionId: null },
        { id: "l2", quantity: 10, costPerToken: 1.5, acquiredAt: new Date(), sourceType: "PURCHASE", sourceTransactionId: null },
      ];
      mockFindMany.mockResolvedValue(lots);
      const result = await getLotsForAsset("asset-1");
      expect(result).toEqual(lots);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assetId: "asset-1" },
          orderBy: { acquiredAt: "asc" },
        })
      );
    });
  });
});
