import { describe, it, expect } from "vitest";
import { getFeeForOrder, getProfitForOrder, computeTransactionFee } from "../../src/services/fee.service.js";

describe("fee.service", () => {
  const baseInput = {
    f_amount: 100,
    t_amount: 0.05,
    f_price: 2000,
    t_price: 2000,
    f_token: "USDC",
    t_token: "ETH",
  };

  describe("getFeeForOrder", () => {
    it("should return correct fee and totalCost for buy (1% fee on f_amount)", () => {
      const result = getFeeForOrder({ ...baseInput, action: "buy" });
      expect(result.feePercent).toBe(1);
      expect(result.feeAmount).toBe(1); // 1% of 100
      expect(result.totalCost).toBe(101); // 100 + 1
      expect(result.grossValue).toBe(100);
      expect(result.profit).toBe(1);
      expect(result.totalReceived).toBe(0.05); // t_amount
      expect(result.rate).toBe(2000); // buy: rate = t_price (output price)
    });

    it("should return correct fee and totalReceived for sell (1% fee deducted from f_amount)", () => {
      const result = getFeeForOrder({ ...baseInput, action: "sell", f_amount: 100, t_amount: 0.05 });
      expect(result.feePercent).toBe(1);
      expect(result.feeAmount).toBe(1); // 1% of 100
      expect(result.totalReceived).toBe(99); // 100 - 1
      expect(result.profit).toBe(1);
      expect(result.grossValue).toBe(100); // t_amount * t_price = 100
    });

    it("should return correct fee for request (0.5% fee)", () => {
      const result = getFeeForOrder({ ...baseInput, action: "request", f_amount: 20, t_amount: 20, f_token: "GHS", t_token: "GHS" });
      expect(result.feePercent).toBe(0.5);
      expect(result.feeAmount).toBe(0.1); // 0.5% of 20
      expect(result.totalCost).toBe(20.1);
      expect(result.profit).toBe(0.1);
    });

    it("should return correct fee for claim (0.5% fee)", () => {
      const result = getFeeForOrder({ ...baseInput, action: "claim", f_amount: 50, t_amount: 50, f_token: "GHS", t_token: "GHS" });
      expect(result.feePercent).toBe(0.5);
      expect(result.feeAmount).toBe(0.25);
      expect(result.totalCost).toBe(50.25);
      expect(result.profit).toBe(0.25);
    });

    it("derives f_price/t_price from amounts when omitted (platform-determined rate)", () => {
      const result = getFeeForOrder({
        action: "buy",
        f_amount: 100,
        t_amount: 0.05,
        f_token: "USDC",
        t_token: "ETH",
      });
      expect(result.rate).toBe(2000);
      expect(result.feeAmount).toBe(1);
      expect(result.totalCost).toBe(101);
    });
  });

  describe("prices and balance + fee", () => {
    it("buy: totalCost should equal f_amount + feeAmount", () => {
      const result = getFeeForOrder({ ...baseInput, action: "buy", f_amount: 200 });
      expect(result.totalCost).toBe(result.grossValue + result.feeAmount);
      expect(result.totalCost).toBe(202); // 200 + 2
    });

    it("sell: totalReceived should equal f_amount - feeAmount", () => {
      const input = { ...baseInput, action: "sell" as const, f_amount: 150 };
      const result = getFeeForOrder(input);
      expect(result.totalReceived).toBe(input.f_amount - result.feeAmount);
      expect(result.totalReceived).toBe(148.5); // 150 - 1.5
    });

    it("request: totalCost should equal f_amount + feeAmount", () => {
      const result = getFeeForOrder({ ...baseInput, action: "request", f_amount: 30 });
      expect(result.totalCost).toBe(30 + result.feeAmount);
      expect(result.feeAmount).toBe(0.15); // 0.5% of 30
    });

    it("claim: totalCost should equal f_amount + feeAmount", () => {
      const result = getFeeForOrder({ ...baseInput, action: "claim", f_amount: 40 });
      expect(result.totalCost).toBe(40 + result.feeAmount);
      expect(result.feeAmount).toBe(0.2); // 0.5% of 40
    });
  });

  describe("profit calculation", () => {
    it("profit should equal feeAmount for all order types", () => {
      const actions = ["buy", "sell", "request", "claim"] as const;
      for (const action of actions) {
        const result = getFeeForOrder({ ...baseInput, action });
        expect(result.profit).toBe(result.feeAmount);
      }
    });

    it("getProfitForOrder should return same as getFeeForOrder(...).profit", () => {
      const result = getFeeForOrder({ ...baseInput, action: "buy" });
      const profit = getProfitForOrder({ ...baseInput, action: "buy" });
      expect(profit).toBe(result.profit);
    });

    it("buy 100 USDC at 1%: profit = 1", () => {
      const profit = getProfitForOrder({ ...baseInput, action: "buy", f_amount: 100 });
      expect(profit).toBe(1);
    });

    it("sell 0.05 ETH receive 100 USDC at 1%: profit = 1", () => {
      const profit = getProfitForOrder({ ...baseInput, action: "sell", f_amount: 100, t_amount: 0.05 });
      expect(profit).toBe(1);
    });

    it("request 20 GHS at 0.5%: profit = 0.1", () => {
      const profit = getProfitForOrder({
        ...baseInput,
        action: "request",
        f_amount: 20,
        t_amount: 20,
        f_token: "GHS",
        t_token: "GHS",
      });
      expect(profit).toBe(0.1);
    });

    it("claim 50 GHS at 0.5%: profit = 0.25", () => {
      const profit = getProfitForOrder({
        ...baseInput,
        action: "claim",
        f_amount: 50,
        t_amount: 50,
        f_token: "GHS",
        t_token: "GHS",
      });
      expect(profit).toBe(0.25);
    });
  });

  describe("rate and grossValue", () => {
    it("rate for buy equals t_price (output price)", () => {
      const result = getFeeForOrder({ ...baseInput, action: "buy", f_price: 2000, t_price: 2000 });
      expect(result.rate).toBe(2000);
    });

    it("sell grossValue should equal t_amount * t_price", () => {
      const result = getFeeForOrder({ ...baseInput, action: "sell", t_amount: 0.1, t_price: 3000 });
      expect(result.grossValue).toBe(300); // 0.1 * 3000
    });
  });

  describe("computeTransactionFee (spread-based, for DB)", () => {
    it("BUY: fee = (sellingPrice - providerPrice) * t_amount", () => {
      // sellingPrice = t_tokenPriceUsd / f_tokenPriceUsd = 12/1 = 12
      expect(
        computeTransactionFee({
          type: "BUY",
          f_amount: 100,
          t_amount: 10,
          f_tokenPriceUsd: 1,
          t_tokenPriceUsd: 12,
          providerPrice: 11,
        })
      ).toBe(10); // (12 - 11) * 10
      expect(
        computeTransactionFee({
          type: "BUY",
          f_amount: 100,
          t_amount: 1000,
          f_tokenPriceUsd: 1,
          t_tokenPriceUsd: 10.75,
          providerPrice: 11,
        })
      ).toBe(-250); // (10.75 - 11) * 1000
    });

    it("BUY: when providerPrice missing, uses sellingPrice so fee = 0", () => {
      expect(
        computeTransactionFee({
          type: "BUY",
          f_amount: 1000,
          t_amount: 0.5,
          f_tokenPriceUsd: 1,
          t_tokenPriceUsd: 3000,
        })
      ).toBe(0);
    });

    it("SELL: fee = (providerPrice - buyPrice) * f_amount, buyPrice = f_tokenPriceUsd/t_tokenPriceUsd", () => {
      // buyPrice = 3000/1 = 3000, providerPrice 3000 => fee 0
      expect(
        computeTransactionFee({
          type: "SELL",
          f_amount: 0.5,
          t_amount: 1500,
          f_tokenPriceUsd: 3000,
          t_tokenPriceUsd: 1,
          providerPrice: 3000,
        })
      ).toBe(0);
      // buyPrice = 3010/1 = 3010, providerPrice 3010 + 10/3000 => fee = (10/3000) * 0.5
      expect(
        computeTransactionFee({
          type: "SELL",
          f_amount: 0.5,
          t_amount: 1500,
          f_tokenPriceUsd: 3010,
          t_tokenPriceUsd: 1,
          providerPrice: 3010 + 10 / 3000,
        })
      ).toBeCloseTo((0.5 * 10) / 3000, 8);
    });

    it("REQUEST/CLAIM: falls back to getFeeForOrder (percentage)", () => {
      expect(
        computeTransactionFee({
          type: "REQUEST",
          f_amount: 20,
          t_amount: 20,
          f_tokenPriceUsd: 1,
          t_tokenPriceUsd: 1,
        })
      ).toBe(0.1);
      expect(
        computeTransactionFee({
          type: "CLAIM",
          f_amount: 50,
          t_amount: 50,
          f_tokenPriceUsd: 1,
          t_tokenPriceUsd: 1,
        })
      ).toBe(0.25);
    });
  });
});
