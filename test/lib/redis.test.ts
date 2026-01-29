import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  balanceKey,
  getBalance,
  setBalance,
  type BalanceEntry,
} from "../../src/lib/redis.js";

vi.mock("../../src/config/env.js", () => ({
  getEnv: () => ({
    REDIS_URL: "redis://localhost:6379",
  }),
}));

const mockHgetall = vi.fn();
const mockHset = vi.fn();
const mockExpire = vi.fn();

vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    hgetall: mockHgetall,
    hset: mockHset,
    expire: mockExpire,
  })),
}));

describe("redis", () => {
  beforeEach(() => {
    mockHgetall.mockReset();
    mockHset.mockReset();
    mockExpire.mockReset();
  });

  describe("balanceKey", () => {
    it("should return key in format balance:chain:token", () => {
      expect(balanceKey("ETHEREUM", "USDC")).toBe("balance:ETHEREUM:USDC");
      expect(balanceKey("BASE", "ETH")).toBe("balance:BASE:ETH");
    });
  });

  describe("getBalance", () => {
    it("should return null when key has no data", async () => {
      mockHgetall.mockResolvedValue({});
      const result = await getBalance("ETHEREUM", "USDC");
      expect(result).toBeNull();
      expect(mockHgetall).toHaveBeenCalledWith("balance:ETHEREUM:USDC");
    });

    it("should return BalanceEntry when hash has data", async () => {
      const entry = { amount: "100", status: "synced", updatedAt: "2025-01-01T00:00:00Z" };
      mockHgetall.mockResolvedValue(entry);
      const result = await getBalance("ETHEREUM", "USDC");
      expect(result).toEqual(entry);
    });
  });

  describe("setBalance", () => {
    it("should call hset and expire with correct key and TTL", async () => {
      const entry: BalanceEntry = {
        amount: "50",
        status: "updated",
        updatedAt: new Date().toISOString(),
      };
      mockHset.mockResolvedValue(1);
      mockExpire.mockResolvedValue(1);
      await setBalance("ETHEREUM", "USDC", entry);
      expect(mockHset).toHaveBeenCalledWith(
        "balance:ETHEREUM:USDC",
        expect.objectContaining({ amount: "50", status: "updated" })
      );
      expect(mockExpire).toHaveBeenCalledWith("balance:ETHEREUM:USDC", 60);
    });
  });
});
