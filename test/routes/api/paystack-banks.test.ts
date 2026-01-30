import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { paystackBanksApiRoutes } from "../../../src/routes/api/paystack-banks.js";
import * as paystackService from "../../../src/services/paystack.service.js";

vi.mock("../../../src/services/paystack.service.js", () => ({
  listBanks: vi.fn(),
  resolveBankAccount: vi.fn(),
  validateBankAccount: vi.fn(),
  isPaystackConfigured: vi.fn(),
}));

const mockListBanks = vi.mocked(paystackService.listBanks);
const mockResolveBankAccount = vi.mocked(paystackService.resolveBankAccount);
const mockValidateBankAccount = vi.mocked(paystackService.validateBankAccount);
const mockIsPaystackConfigured = vi.mocked(paystackService.isPaystackConfigured);

describe("Paystack banks API", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    await app.register(paystackBanksApiRoutes, { prefix: "" });
  });

  describe("GET /api/paystack/banks", () => {
    it("returns 503 when Paystack is not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);

      const res = await app.inject({ method: "GET", url: "/api/paystack/banks" });

      expect(res.statusCode).toBe(503);
      const json = res.json() as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toContain("Paystack");
      expect(mockListBanks).not.toHaveBeenCalled();
    });

    it("returns 400 when country is invalid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/banks?country=invalid",
      });

      expect(res.statusCode).toBe(400);
      const json = res.json() as { success: boolean; error: string };
      expect(json.error).toContain("Validation");
      expect(mockListBanks).not.toHaveBeenCalled();
    });

    it("returns 200 with banks when configured and query valid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockListBanks.mockResolvedValue({
        data: [{ id: 1, name: "Test Bank", code: "001", slug: "test-bank", country: "Nigeria", currency: "NGN", type: "nuban" }],
        meta: { perPage: 50 },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/banks?country=nigeria",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { banks: unknown[]; meta?: unknown } };
      expect(json.success).toBe(true);
      expect(json.data.banks).toHaveLength(1);
      expect(json.data.banks[0]).toMatchObject({ name: "Test Bank", code: "001" });
      expect(mockListBanks).toHaveBeenCalledWith(expect.objectContaining({ country: "nigeria" }));
    });

    it("maps south_africa to south africa for Paystack", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockListBanks.mockResolvedValue({ data: [], meta: {} });

      await app.inject({
        method: "GET",
        url: "/api/paystack/banks?country=south_africa",
      });

      expect(mockListBanks).toHaveBeenCalledWith(expect.objectContaining({ country: "south africa" }));
    });
  });

  describe("GET /api/paystack/banks/resolve", () => {
    it("returns 503 when Paystack is not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/banks/resolve?account_number=0022728151&bank_code=063",
      });

      expect(res.statusCode).toBe(503);
      expect(mockResolveBankAccount).not.toHaveBeenCalled();
    });

    it("returns 400 when account_number or bank_code missing", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/banks/resolve?account_number=0022728151",
      });

      expect(res.statusCode).toBe(400);
      expect(mockResolveBankAccount).not.toHaveBeenCalled();
    });

    it("returns 200 with account_name when resolved", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockResolveBankAccount.mockResolvedValue({
        account_number: "0022728151",
        account_name: "WES GIBBONS",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/paystack/banks/resolve?account_number=0022728151&bank_code=063",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { account_number: string; account_name: string } };
      expect(json.success).toBe(true);
      expect(json.data.account_name).toBe("WES GIBBONS");
      expect(json.data.account_number).toBe("0022728151");
      expect(mockResolveBankAccount).toHaveBeenCalledWith("0022728151", "063");
    });
  });

  describe("POST /api/paystack/banks/validate", () => {
    it("returns 503 when Paystack is not configured", async () => {
      mockIsPaystackConfigured.mockReturnValue(false);

      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/banks/validate",
        payload: {
          bank_code: "632005",
          country_code: "ZA",
          account_number: "0123456789",
          account_name: "Ann Bron",
          account_type: "personal",
          document_type: "identityNumber",
          document_number: "1234567890123",
        },
      });

      expect(res.statusCode).toBe(503);
      expect(mockValidateBankAccount).not.toHaveBeenCalled();
    });

    it("returns 400 when body is invalid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);

      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/banks/validate",
        payload: { bank_code: "632005" },
      });

      expect(res.statusCode).toBe(400);
      expect(mockValidateBankAccount).not.toHaveBeenCalled();
    });

    it("returns 200 with verification result when valid", async () => {
      mockIsPaystackConfigured.mockReturnValue(true);
      mockValidateBankAccount.mockResolvedValue({
        verified: true,
        verificationMessage: "Account is verified successfully",
        accountHolderMatch: true,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/paystack/banks/validate",
        payload: {
          bank_code: "632005",
          country_code: "ZA",
          account_number: "0123456789",
          account_name: "Ann Bron",
          account_type: "personal",
          document_type: "identityNumber",
          document_number: "1234567890123",
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json() as { success: boolean; data: { verified: boolean; verificationMessage?: string } };
      expect(json.success).toBe(true);
      expect(json.data.verified).toBe(true);
      expect(json.data.verificationMessage).toBe("Account is verified successfully");
      expect(mockValidateBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          bank_code: "632005",
          account_number: "0123456789",
          account_type: "personal",
        })
      );
    });
  });
});
