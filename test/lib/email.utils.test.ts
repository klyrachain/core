import { describe, it, expect } from "vitest";
import { createIdempotencyKey, emailHeaders } from "../../src/lib/email.utils.js";

describe("email.utils", () => {
  describe("createIdempotencyKey", () => {
    it("returns a UUID string", () => {
      const key = createIdempotencyKey();
      expect(key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("returns unique keys on each call", () => {
      const a = createIdempotencyKey();
      const b = createIdempotencyKey();
      expect(a).not.toBe(b);
    });
  });

  describe("emailHeaders", () => {
    it("returns X-Entity-Ref-ID with given value", () => {
      const h = emailHeaders("req-123");
      expect(h["X-Entity-Ref-ID"]).toBe("req-123");
    });
  });
});
