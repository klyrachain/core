import { describe, it, expect, beforeEach, vi } from "vitest";
import { WalletManager } from "../../src/utils/wallet-manager.js";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef"; // 32 chars

vi.mock("../../src/config/env.js", () => ({
  getEnv: () => ({ ENCRYPTION_KEY }),
}));

describe("WalletManager", () => {
  describe("encrypt and decrypt", () => {
    it("should decrypt to original plaintext after encrypt", () => {
      const plain = "my-secret-private-key";
      const encrypted = WalletManager.encrypt(plain);
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
      expect(/^[0-9a-f]+$/i.test(encrypted)).toBe(true);
      const decrypted = WalletManager.decrypt(encrypted);
      expect(decrypted).toBe(plain);
    });

    it("should produce different ciphertext each time due to random salt/iv", () => {
      const plain = "same-content";
      const e1 = WalletManager.encrypt(plain);
      const e2 = WalletManager.encrypt(plain);
      expect(e1).not.toBe(e2);
      expect(WalletManager.decrypt(e1)).toBe(plain);
      expect(WalletManager.decrypt(e2)).toBe(plain);
    });
  });

  describe("decrypt", () => {
    it("should throw when encrypted payload is too short", () => {
      const shortHex = Buffer.from([1, 2, 3]).toString("hex");
      expect(() => WalletManager.decrypt(shortHex)).toThrow("Invalid encrypted key format");
    });

    it("should throw when input is not valid hex", () => {
      expect(() => WalletManager.decrypt("not-hex!!!")).toThrow();
    });
  });
});
