import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convertAmountViaUsdRates } from "../../src/services/exchange-rate.service.js";

describe("convertAmountViaUsdRates", () => {
  const rates: Record<string, number> = {
    USD: 1,
    GHS: 12,
    EUR: 0.9,
    NGN: 1500,
  };

  it("returns same amount when from === to", () => {
    expect(convertAmountViaUsdRates("GHS", "GHS", 100, rates)).toBe(100);
  });

  it("converts GHS to EUR via USD semantics (units per 1 USD)", () => {
    // 120 GHS = 10 USD = 9 EUR
    expect(convertAmountViaUsdRates("GHS", "EUR", 120, rates)).toBeCloseTo(9, 5);
  });

  it("converts EUR to NGN", () => {
    // 9 EUR -> 9/0.9 = 10 USD -> 15000 NGN
    expect(convertAmountViaUsdRates("EUR", "NGN", 9, rates)).toBeCloseTo(15000, 5);
  });

  it("throws when currency missing from table", () => {
    expect(() => convertAmountViaUsdRates("GHS", "XXX", 10, rates)).toThrow(/XXX/);
  });
});

const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  DIRECT_URL: "postgresql://u:p@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(32),
  EXCHANGERATE_API_KEY: "test-ex-rate-key",
} as const;

describe("getCachedUsdConversionRates", () => {
  beforeEach(async () => {
    Object.assign(process.env, testEnv);
    const { loadEnv } = await import("../../src/config/env.js");
    loadEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: "success",
          base_code: "USD",
          conversion_rates: { USD: 1, GHS: 10, EUR: 0.85 },
          time_last_update_utc: "Mon, 01 Jan 2024",
        }),
      })
    );
    const mod = await import("../../src/services/exchange-rate.service.js");
    mod._resetUsdRatesCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches once and caches within same tick", async () => {
    const mod = await import("../../src/services/exchange-rate.service.js");
    const a = await mod.getCachedUsdConversionRates();
    const b = await mod.getCachedUsdConversionRates();
    expect(a.rates.GHS).toBe(10);
    expect(b.rates.EUR).toBe(0.85);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
