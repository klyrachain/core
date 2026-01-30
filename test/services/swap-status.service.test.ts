import { describe, it, expect, beforeEach, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const requiredEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DIRECT_URL: "postgresql://u:p@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(32),
};

async function loadSwapStatusService() {
  Object.assign(process.env, requiredEnv);
  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv();
  return await import("../../src/services/swap-status.service.js");
}

describe("swap-status.service", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.ZEROX_API_KEY = "0x-key";
    process.env.SQUID_INTEGRATOR_ID = "squid-id";
  });

  describe("get0xSwapStatus", () => {
    it("returns normalized status and provider_status from 0x response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "confirmed",
          transactions: [{ hash: "0xabc", timestamp: 1234567890 }],
        }),
      });
      const mod = await loadSwapStatusService();
      const result = await mod.get0xSwapStatus("0xabc", 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe("0x");
        expect(result.normalized).toBe("CONFIRMED");
        expect(result.providerStatus).toBe("confirmed");
        expect(result.txHash).toBe("0xabc");
      }
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/tx-relay/v1/swap/status/0xabc"),
        expect.objectContaining({
          headers: expect.objectContaining({ "0x-api-key": "0x-key", "0x-chain-id": "1" }),
        })
      );
    });

    it("returns FAILED when 0x returns failed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "failed", reason: "transaction_reverted" }),
      });
      const mod = await loadSwapStatusService();
      const result = await mod.get0xSwapStatus("0xbad", 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.normalized).toBe("FAILED");
        expect(result.providerMessage).toBe("transaction_reverted");
      }
    });

    it("returns ok: false when 0x API key missing", async () => {
      delete process.env.ZEROX_API_KEY;
      const { loadEnv } = await import("../../src/config/env.js");
      loadEnv();
      const mod = await import("../../src/services/swap-status.service.js");
      const result = await mod.get0xSwapStatus("0xabc", 1);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("0x API key");
      process.env.ZEROX_API_KEY = "0x-key";
    });
  });

  describe("getSquidSwapStatus", () => {
    it("returns normalized status from Squid response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          squidTransactionStatus: "SUCCESS",
          fromChain: { transactionId: "0xfrom", explorerUrl: "https://explorer/0xfrom" },
        }),
      });
      const mod = await loadSwapStatusService();
      const result = await mod.getSquidSwapStatus("0xfrom", 1, 8453);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe("squid");
        expect(result.normalized).toBe("CONFIRMED");
        expect(result.providerStatus).toBe("SUCCESS");
      }
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("v2/status"),
        expect.objectContaining({
          headers: { "x-integrator-id": "squid-id" },
        })
      );
    });
  });

  describe("getLiFiSwapStatus", () => {
    it("returns normalized status from LiFi response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "DONE",
          substatusMessage: "Complete",
          sending: { txHash: "0xsend", txLink: "https://li.fi/tx/0xsend" },
        }),
      });
      const mod = await loadSwapStatusService();
      const result = await mod.getLiFiSwapStatus("0xsend", 1, 8453);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe("lifi");
        expect(result.normalized).toBe("CONFIRMED");
        expect(result.providerStatus).toBe("DONE");
      }
    });
  });

  describe("getSwapStatusFromProvider", () => {
    it("delegates to 0x when provider is 0x", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "submitted", transactions: [] }),
      });
      const mod = await loadSwapStatusService();
      const result = await mod.getSwapStatusFromProvider("0x", "0xhash", 1, 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.provider).toBe("0x");
    });

    it("returns ok: false for unknown provider", async () => {
      const mod = await loadSwapStatusService();
      const result = await mod.getSwapStatusFromProvider(
        "unknown" as "0x",
        "0xhash",
        1,
        1
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Unknown provider");
    });
  });
});
