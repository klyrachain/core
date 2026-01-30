import { describe, it, expect, beforeEach, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const PAYSTACK_SECRET = "sk_test_abc";

const requiredEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DIRECT_URL: "postgresql://u:p@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(32),
};

async function loadPaystackService() {
  Object.assign(process.env, requiredEnv, { PAYSTACK_SECRET_KEY: PAYSTACK_SECRET });
  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv();
  return await import("../../src/services/paystack.service.js");
}

describe("paystack.service", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;
  });

  describe("isPaystackConfigured", () => {
    it("returns true when PAYSTACK_SECRET_KEY is set", async () => {
      const mod = await loadPaystackService();
      expect(mod.isPaystackConfigured()).toBe(true);
    });

    it("returns false when PAYSTACK_SECRET_KEY is not set", async () => {
      const { PAYSTACK_SECRET_KEY: _removed, ...rest } = process.env;
      Object.assign(process.env, rest, requiredEnv);
      delete process.env.PAYSTACK_SECRET_KEY;
      const { loadEnv } = await import("../../src/config/env.js");
      loadEnv();
      const mod = await import("../../src/services/paystack.service.js");
      expect(mod.isPaystackConfigured()).toBe(false);
    });
  });

  describe("listBanks", () => {
    it("returns simplified bank list from Paystack response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          message: "Banks retrieved",
          data: [
            {
              id: 174,
              name: "Abbey Mortgage Bank",
              slug: "abbey-mortgage-bank",
              code: "801",
              country: "Nigeria",
              currency: "NGN",
              type: "nuban",
            },
          ],
        }),
      });

      const mod = await loadPaystackService();
      const result = await mod.listBanks({ country: "nigeria" });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: 174,
        name: "Abbey Mortgage Bank",
        code: "801",
        slug: "abbey-mortgage-bank",
        country: "Nigeria",
        currency: "NGN",
        type: "nuban",
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/bank?"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${PAYSTACK_SECRET}`,
          }),
        })
      );
    });

    it("throws when Paystack returns status false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ status: false, message: "Invalid country" }),
      });

      const mod = await loadPaystackService();
      await expect(mod.listBanks({ country: "invalid" })).rejects.toThrow("Invalid country");
    });
  });

  describe("resolveBankAccount", () => {
    it("returns account_number and account_name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          message: "Account number resolved",
          data: { account_number: "0022728151", account_name: "WES GIBBONS" },
        }),
      });

      const mod = await loadPaystackService();
      const result = await mod.resolveBankAccount("0022728151", "063");

      expect(result).toEqual({ account_number: "0022728151", account_name: "WES GIBBONS" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/bank/resolve"),
        expect.any(Object)
      );
    });
  });

  describe("validateBankAccount", () => {
    it("returns verified and verificationMessage", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          message: "Personal Account Verification attempted",
          data: {
            verified: true,
            verificationMessage: "Account is verified successfully",
            accountHolderMatch: true,
          },
        }),
      });

      const mod = await loadPaystackService();
      const result = await mod.validateBankAccount({
        bank_code: "632005",
        country_code: "ZA",
        account_number: "0123456789",
        account_name: "Ann Bron",
        account_type: "personal",
        document_type: "identityNumber",
        document_number: "1234567890123",
      });

      expect(result.verified).toBe(true);
      expect(result.verificationMessage).toBe("Account is verified successfully");
      expect(result.accountHolderMatch).toBe(true);
    });
  });

  describe("listMobileMoneyProviders", () => {
    it("calls listBanks with type mobile_money and currency", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          message: "Banks retrieved",
          data: [
            { id: 1, name: "MTN", code: "MTN", slug: "mtn", country: "Ghana", currency: "GHS", type: "mobile_money" },
          ],
        }),
      });

      const mod = await loadPaystackService();
      const result = await mod.listMobileMoneyProviders({ currency: "GHS" });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("MTN");
      expect(result.data[0].type).toBe("mobile_money");
      const callUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("currency=GHS");
      expect(callUrl).toContain("type=mobile_money");
    });
  });

  describe("sanitizeTransactionData", () => {
    it("strips sensitive authorization fields and keeps only channel, card_type, bank, country_code, reusable", async () => {
      const mod = await loadPaystackService();
      const data = {
        id: 1,
        status: "success",
        reference: "ref_1",
        amount: 10000,
        currency: "NGN",
        paid_at: "2025-01-30T12:00:00.000Z",
        created_at: "2025-01-30T11:00:00.000Z",
        channel: "card",
        gateway_response: "Approved",
        message: null,
        authorization: {
          authorization_code: "AUTH_xxx",
          last4: "4081",
          exp_month: "12",
          exp_year: "2030",
          channel: "card",
          card_type: "visa",
          bank: "TEST BANK",
          country_code: "NG",
          brand: "visa",
          reusable: true,
        },
      };
      const out = mod.sanitizeTransactionData(data as any);
      expect(out.authorization).toEqual({
        channel: "card",
        card_type: "visa",
        bank: "TEST BANK",
        country_code: "NG",
        reusable: true,
      });
      expect((out.authorization as any).authorization_code).toBeUndefined();
      expect((out.authorization as any).last4).toBeUndefined();
      expect((out.authorization as any).exp_month).toBeUndefined();
      expect((out.authorization as any).exp_year).toBeUndefined();
      expect((out.authorization as any).brand).toBeUndefined();
    });

    it("returns copy with no authorization when input has no authorization", async () => {
      const mod = await loadPaystackService();
      const data = { id: 1, status: "success", reference: "r1", amount: 100, currency: "NGN" };
      const out = mod.sanitizeTransactionData(data as any);
      expect(out).toEqual(data);
      expect(out.authorization).toBeUndefined();
    });
  });
});
