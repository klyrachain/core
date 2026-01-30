import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createCryptoTransaction,
  updateCryptoTransaction,
  getCryptoTransactionById,
  getCryptoTransactionByTxHash,
  listCryptoTransactions,
} from "../../src/services/crypto-transaction.service.js";

const mockCreate = vi.fn();
const mockUpdateMany = vi.fn();
const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockCount = vi.fn();

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    cryptoTransaction: {
      create: (arg: unknown) => mockCreate(arg),
      updateMany: (arg: unknown) => mockUpdateMany(arg),
      findUnique: (arg: unknown) => mockFindUnique(arg),
      findFirst: (arg: unknown) => mockFindFirst(arg),
      findMany: (arg: unknown) => mockFindMany(arg),
      count: (arg: unknown) => mockCount(arg),
    },
  },
}));

describe("crypto-transaction.service", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdateMany.mockReset();
    mockFindUnique.mockReset();
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockCount.mockReset();
  });

  describe("createCryptoTransaction", () => {
    it("returns id and creates with PENDING status", async () => {
      mockCreate.mockResolvedValue({ id: "ct-123" });
      const result = await createCryptoTransaction({
        provider: "0x",
        fromChainId: 1,
        toChainId: 1,
        fromToken: "0xaaa",
        toToken: "0xbbb",
        fromAmount: "1000000",
        toAmount: "2000000",
      });
      expect(result).toEqual({ id: "ct-123" });
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          provider: "0x",
          fromChainId: 1,
          toChainId: 1,
          fromToken: "0xaaa",
          toToken: "0xbbb",
          fromAmount: "1000000",
          toAmount: "2000000",
          status: "PENDING",
          transactionId: null,
          metadata: undefined,
        },
        select: { id: true },
      });
    });

    it("passes transactionId and metadata when provided", async () => {
      mockCreate.mockResolvedValue({ id: "ct-456" });
      await createCryptoTransaction({
        provider: "squid",
        fromChainId: 8453,
        toChainId: 1,
        fromToken: "0xa",
        toToken: "0xb",
        fromAmount: "1",
        toAmount: "2",
        transactionId: "tx-uuid",
        metadata: { source: "best" },
      });
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionId: "tx-uuid",
          metadata: { source: "best" },
        }),
        select: { id: true },
      });
    });
  });

  describe("updateCryptoTransaction", () => {
    it("returns id when update succeeds", async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      const result = await updateCryptoTransaction("ct-123", {
        status: "CONFIRMED",
        txHash: "0xabc",
      });
      expect(result).toEqual({ id: "ct-123" });
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: "ct-123" },
        data: expect.objectContaining({ status: "CONFIRMED", txHash: "0xabc" }),
      });
    });

    it("returns null when no row updated", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      const result = await updateCryptoTransaction("nonexistent", { status: "FAILED" });
      expect(result).toBeNull();
    });
  });

  describe("getCryptoTransactionById", () => {
    it("returns null when not found", async () => {
      mockFindUnique.mockResolvedValue(null);
      const result = await getCryptoTransactionById("ct-123");
      expect(result).toBeNull();
    });

    it("returns serialized row when found", async () => {
      const row = {
        id: "ct-123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        provider: "0x",
        status: "CONFIRMED",
        fromChainId: 1,
        toChainId: 1,
        fromToken: "0xa",
        toToken: "0xb",
        fromAmount: "100",
        toAmount: "200",
        txHash: "0xhash",
        txUrl: null,
        transactionId: null,
        metadata: null,
        transaction: null,
      };
      mockFindUnique.mockResolvedValue(row);
      const result = await getCryptoTransactionById("ct-123");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("ct-123");
      expect(result?.provider).toBe("0x");
      expect(result?.status).toBe("CONFIRMED");
      expect(result?.txHash).toBe("0xhash");
      expect(result?.createdAt).toBe("2025-01-01T00:00:00.000Z");
    });
  });

  describe("getCryptoTransactionByTxHash", () => {
    it("returns null when not found", async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await getCryptoTransactionByTxHash("0xabc");
      expect(result).toBeNull();
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { txHash: "0xabc" } })
      );
    });
  });

  describe("listCryptoTransactions", () => {
    it("returns items, total, page, limit", async () => {
      const rows = [
        {
          id: "ct-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          provider: "0x",
          status: "PENDING",
          fromChainId: 1,
          toChainId: 1,
          fromToken: "0xa",
          toToken: "0xb",
          fromAmount: "1",
          toAmount: "2",
          txHash: null,
          txUrl: null,
          transactionId: null,
          metadata: null,
          transaction: null,
        },
      ];
      mockFindMany.mockResolvedValue(rows);
      mockCount.mockResolvedValue(1);
      const result = await listCryptoTransactions({ page: 1, limit: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });
});
