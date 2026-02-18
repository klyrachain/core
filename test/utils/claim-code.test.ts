import { describe, it, expect } from "vitest";
import { generateClaimOtp, generateClaimCode } from "../../src/utils/claim-code.js";

describe("claim-code", () => {
  describe("generateClaimOtp", () => {
    it("returns 6-digit string", () => {
      const otp = generateClaimOtp();
      expect(otp).toMatch(/^\d{6}$/);
    });
  });

  describe("generateClaimCode", () => {
    it("returns 6-character alphanumeric string", () => {
      const code = generateClaimCode();
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(code.length).toBe(6);
    });
  });
});
