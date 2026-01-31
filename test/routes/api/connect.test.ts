import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { connectApiRoutes } from "../../../src/routes/api/connect.js";

const mockTransactionFindMany = vi.fn();
const mockBusinessFindMany = vi.fn();
const mockBusinessFindUnique = vi.fn();
const mockApiKeyFindMany = vi.fn();
const mockPayoutFindMany = vi.fn();
const mockPayoutFindUnique = vi.fn();
const mockPayoutCount = vi.fn();
const mockBusinessCount = vi.fn();

vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    transaction: { findMany: (...args: unknown[]) => mockTransactionFindMany(...args) },
    business: {
      findMany: (...args: unknown[]) => mockBusinessFindMany(...args),
      findUnique: (...args: unknown[]) => mockBusinessFindUnique(...args),
      count: (...args: unknown[]) => mockBusinessCount(...args),
    },
    apiKey: { findMany: (...args: unknown[]) => mockApiKeyFindMany(...args) },
    payout: {
      findMany: (...args: unknown[]) => mockPayoutFindMany(...args),
      findUnique: (...args: unknown[]) => mockPayoutFindUnique(...args),
      count: (...args: unknown[]) => mockPayoutCount(...args),
    },
  },
}));

type ApiKeyContext = {
  id: string;
  name: string;
  permissions: string[];
  businessId: string | null;
} | null;

describe("Connect API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let apiKeyContext: ApiKeyContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    apiKeyContext = null;
    app = Fastify();
    app.addHook("preHandler", (req, _reply, done) => {
      (req as { apiKey?: ApiKeyContext }).apiKey = apiKeyContext;
      done();
    });
    await app.register(connectApiRoutes, { prefix: "" });
  });

  describe("GET /api/connect/overview", () => {
    it("returns 401 when apiKey is not set", async () => {
      const res = await app.inject({ method: "GET", url: "/api/connect/overview" });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { success: boolean }).success).toBe(false);
    });

    it("returns 403 when merchant key (platform only)", async () => {
      apiKeyContext = {
        id: "k1",
        name: "Merchant",
        permissions: ["*"],
        businessId: "biz-1",
      };
      const res = await app.inject({ method: "GET", url: "/api/connect/overview" });
      expect(res.statusCode).toBe(403);
      const json = res.json() as { success: boolean; error: string };
      expect(json.error).toContain("platform use only");
    });

    it("returns 200 with overview shape when platform key", async () => {
      apiKeyContext = {
        id: "k0",
        name: "Platform",
        permissions: ["*"],
        businessId: null,
      };
      mockTransactionFindMany.mockResolvedValue([
        {
          id: "tx1",
          businessId: "biz-1",
          createdAt: new Date(),
          f_amount: 100,
          t_amount: 0.05,
          f_price: 2000,
          t_price: 2000,
          platformFee: 1,
        },
      ]);
      mockBusinessFindMany
        .mockResolvedValueOnce([{ id: "biz-1", name: "Acme Inc" }])
        .mockResolvedValueOnce([{ id: "biz-1", name: "Acme Inc", slug: "acme", createdAt: new Date() }]);
      mockApiKeyFindMany.mockResolvedValue([{ businessId: "biz-1", createdAt: new Date() }]);

      const res = await app.inject({ method: "GET", url: "/api/connect/overview" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as {
        success: boolean;
        data: {
          totalPlatformVolume: number;
          netRevenueFees: number;
          activeMerchants: number;
          volumeByPartner: unknown[];
          takeRate: number;
          recentOnboarding: unknown[];
        };
      };
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty("totalPlatformVolume");
      expect(json.data).toHaveProperty("netRevenueFees");
      expect(json.data).toHaveProperty("activeMerchants");
      expect(Array.isArray(json.data.volumeByPartner)).toBe(true);
      expect(typeof json.data.takeRate).toBe("number");
      expect(Array.isArray(json.data.recentOnboarding)).toBe(true);
    });
  });

  describe("GET /api/connect/merchants", () => {
    it("returns 401 when apiKey is not set", async () => {
      const res = await app.inject({ method: "GET", url: "/api/connect/merchants" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 when merchant key", async () => {
      apiKeyContext = { id: "k1", name: "M", permissions: [], businessId: "biz-1" };
      const res = await app.inject({ method: "GET", url: "/api/connect/merchants" });
      expect(res.statusCode).toBe(403);
    });

    it("returns 200 with list and meta when platform key", async () => {
      apiKeyContext = { id: "k0", name: "Platform", permissions: ["*"], businessId: null };
      mockBusinessFindMany.mockResolvedValue([
        {
          id: "biz-1",
          name: "Acme Inc",
          slug: "acme",
          logoUrl: null,
          kybStatus: "APPROVED",
          riskScore: 10,
          createdAt: new Date(),
          feeSchedule: { percentageFee: 1, flatFee: 0, maxFee: 50 },
        },
      ]);
      mockBusinessCount.mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/api/connect/merchants?page=1&limit=10" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: unknown[]; meta: { page: number; limit: number; total: number } };
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.meta).toEqual({ page: 1, limit: 10, total: 1 });
      expect((json.data[0] as { accountId: string }).accountId).toBe("acct_acme");
    });
  });

  describe("GET /api/connect/merchants/:id", () => {
    it("returns 403 when merchant key views another business", async () => {
      apiKeyContext = { id: "k1", name: "M", permissions: [], businessId: "biz-own" };
      mockBusinessFindUnique.mockResolvedValue({
        id: "biz-other",
        name: "Other",
        slug: "other",
        apiKeys: [],
        _count: { transactions: 0 },
      });
      const res = await app.inject({ method: "GET", url: "/api/connect/merchants/biz-other" });
      expect(res.statusCode).toBe(403);
    });

    it("returns 200 with merchant detail when platform key", async () => {
      apiKeyContext = { id: "k0", name: "Platform", permissions: ["*"], businessId: null };
      mockBusinessFindUnique.mockResolvedValue({
        id: "biz-1",
        name: "Acme Inc",
        slug: "acme",
        logoUrl: null,
        website: null,
        supportEmail: null,
        kybStatus: "APPROVED",
        riskScore: 10,
        webhookUrl: "https://acme.example.com/webhook",
        createdAt: new Date(),
        apiKeys: [{ id: "key1", keyPrefix: "sk_live", name: "Backend", lastUsedAt: null, isActive: true }],
        _count: { transactions: 5 },
      });
      mockTransactionFindMany.mockResolvedValue([]);

      const res = await app.inject({ method: "GET", url: "/api/connect/merchants/biz-1" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { webhookUrl: string; apiKeys: unknown[]; volume30d: number } };
      expect(json.data.webhookUrl).toBe("https://acme.example.com/webhook");
      expect(json.data.apiKeys).toHaveLength(1);
      expect(json.data.volume30d).toBe(0);
    });
  });

  describe("GET /api/connect/settlements", () => {
    it("returns 401 when apiKey is not set", async () => {
      const res = await app.inject({ method: "GET", url: "/api/connect/settlements" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 200 with list and meta", async () => {
      apiKeyContext = { id: "k0", name: "Platform", permissions: ["*"], businessId: null };
      mockPayoutFindMany.mockResolvedValue([
        {
          id: "p1",
          batchId: "batch-1",
          businessId: "biz-1",
          amount: 50230,
          fee: 25,
          currency: "USD",
          status: "PAID",
          reference: "WIRE-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          business: { id: "biz-1", name: "Acme Inc", slug: "acme" },
        },
      ]);
      mockPayoutCount.mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/api/connect/settlements?page=1&limit=10" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: unknown[]; meta: { total: number } };
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect((json.data[0] as { businessName: string }).businessName).toBe("Acme Inc");
      expect(json.meta.total).toBe(1);
    });
  });

  describe("GET /api/connect/settlements/:id", () => {
    it("returns 404 when payout not found", async () => {
      apiKeyContext = { id: "k0", name: "Platform", permissions: ["*"], businessId: null };
      mockPayoutFindUnique.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/connect/settlements/pay-nonexistent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 200 with payout detail and timeline", async () => {
      apiKeyContext = { id: "k0", name: "Platform", permissions: ["*"], businessId: null };
      mockPayoutFindUnique.mockResolvedValue({
        id: "p1",
        batchId: "batch-1",
        amount: 50230,
        fee: 25,
        currency: "USD",
        status: "PAID",
        reference: "WIRE-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        business: { id: "biz-1", name: "Acme Inc", slug: "acme" },
        method: { id: "m1", type: "BANK_ACCOUNT", currency: "USD" },
      });

      const res = await app.inject({ method: "GET", url: "/api/connect/settlements/p1" });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { amount: number; timeline: unknown[]; sourceTransactions: unknown[] } };
      expect(json.data.amount).toBe(50230);
      expect(Array.isArray(json.data.timeline)).toBe(true);
      expect(json.data.sourceTransactions).toEqual([]);
    });
  });
});
