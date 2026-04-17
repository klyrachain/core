import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** Avoid loading `core/.env` during tests (would inject REDIS_* and break expectations). */
vi.mock("dotenv/config", () => ({}));

import { loadEnv, getEnv } from "../../src/config/env.js";

const requiredEnv = {
  NODE_ENV: "test",
  PORT: "4000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  ENCRYPTION_KEY: "a".repeat(32),
};

describe("env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    const withoutRedis = { ...originalEnv };
    for (const k of Object.keys(withoutRedis)) {
      if (k.startsWith("REDIS")) delete withoutRedis[k];
    }
    process.env = { ...withoutRedis, ...requiredEnv };
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

    it("should merge REDIS_PASSWORD into host-only REDIS_URL (default ACL user)", async () => {
      vi.resetModules();
      process.env = {
        ...requiredEnv,
        REDIS_URL: "redis://cache.example:15912",
        REDIS_PASSWORD: "mySecretPass",
      };
      const mod = await import("../../src/config/env.js");
      const env = mod.loadEnv();
      const u = new URL(env.REDIS_URL);
      expect(u.username).toBe("default");
      expect(u.password).toBe("mySecretPass");
      expect(u.hostname).toBe("cache.example");
      expect(u.port).toBe("15912");
    });

    it("should merge REDIS_USERNAME when set with host-only REDIS_URL", async () => {
      vi.resetModules();
      process.env = {
        ...requiredEnv,
        REDIS_URL: "redis://cache.example:6379",
        REDIS_USERNAME: "appuser",
        REDIS_PASSWORD: "pw",
      };
      const mod = await import("../../src/config/env.js");
      const env = mod.loadEnv();
      const u = new URL(env.REDIS_URL);
      expect(u.username).toBe("appuser");
      expect(u.password).toBe("pw");
    });

    it("should use rediss when REDIS_TLS and merging auth", async () => {
      vi.resetModules();
      process.env = {
        ...requiredEnv,
        REDIS_URL: "redis://cache.example:15912",
        REDIS_PASSWORD: "pw",
        REDIS_TLS: "true",
      };
      const mod = await import("../../src/config/env.js");
      const env = mod.loadEnv();
      expect(env.REDIS_URL.startsWith("rediss://")).toBe(true);
    });

    it("should not override userinfo already present in REDIS_URL", async () => {
      vi.resetModules();
      process.env = {
        ...requiredEnv,
        REDIS_URL: "redis://existing:existingpw@cache.example:6379",
        REDIS_PASSWORD: "different",
      };
      const mod = await import("../../src/config/env.js");
      const env = mod.loadEnv();
      const u = new URL(env.REDIS_URL);
      expect(u.username).toBe("existing");
      expect(u.password).toBe("existingpw");
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
