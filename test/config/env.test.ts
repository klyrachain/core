import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEnv, getEnv } from "../../src/config/env.js";

const requiredEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(32),
};

describe("env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, ...requiredEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loadEnv", () => {
    it("should return parsed env when all required vars are set", async () => {
      const mod = await import("../../src/config/env.js");
      const env = mod.loadEnv();
      expect(env.DATABASE_URL).toBe(requiredEnv.DATABASE_URL);
      expect(env.ENCRYPTION_KEY).toBe(requiredEnv.ENCRYPTION_KEY);
      expect(env.NODE_ENV).toBe("test");
      expect(env.PORT).toBe(4000);
      expect(env.REDIS_URL).toBe("redis://localhost:6379");
    });

    it("should throw when DATABASE_URL is missing", async () => {
      const { DATABASE_URL, ...rest } = process.env;
      process.env.DATABASE_URL = "";
      const mod = await import("../../src/config/env.js");
      expect(() => mod.loadEnv()).toThrow(/Invalid environment/);
      process.env.DATABASE_URL = requiredEnv.DATABASE_URL;
    });

    it("should throw when ENCRYPTION_KEY is too short", async () => {
      process.env.ENCRYPTION_KEY = "short";
      const mod = await import("../../src/config/env.js");
      expect(() => mod.loadEnv()).toThrow(/ENCRYPTION_KEY/);
      process.env.ENCRYPTION_KEY = requiredEnv.ENCRYPTION_KEY;
    });
  });

  describe("getEnv", () => {
    it("should return env after loadEnv has been called", async () => {
      const mod = await import("../../src/config/env.js");
      mod.loadEnv();
      const env = mod.getEnv();
      expect(env).toBeDefined();
      expect(env.DATABASE_URL).toBe(requiredEnv.DATABASE_URL);
    });

    it("should throw when getEnv is called before loadEnv", async () => {
      vi.resetModules();
      process.env = { ...originalEnv, ...requiredEnv };
      const mod = await import("../../src/config/env.js");
      expect(() => mod.getEnv()).toThrow("Env not loaded");
    });
  });
});
