import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  triggerTransactionStatusChange,
  triggerToChannel,
} from "../../src/services/pusher.service.js";

const mockTrigger = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  getEnv: vi.fn(() => ({
    PUSHER_APP_ID: "",
    PUSHER_KEY: "",
    PUSHER_SECRET: "",
    PUSHER_CLUSTER: "mt1",
  })),
}));

vi.mock("pusher", () => ({
  default: vi.fn().mockImplementation(() => ({
    trigger: mockTrigger,
  })),
}));

describe("pusher.service", () => {
  beforeEach(() => {
    mockTrigger.mockReset();
  });

  describe("triggerTransactionStatusChange", () => {
    it("should not call pusher when config is empty (no client)", async () => {
      await triggerTransactionStatusChange({
        transactionId: "tx-1",
        status: "COMPLETED",
        type: "BUY",
      });
      expect(mockTrigger).not.toHaveBeenCalled();
    });

    it("should resolve without throwing when payload is valid", async () => {
      await expect(
        triggerTransactionStatusChange({
          transactionId: "tx-1",
          status: "FAILED",
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("triggerToChannel", () => {
    it("should not call pusher when client is null", async () => {
      await triggerToChannel("private-user-1", "event", { foo: "bar" });
      expect(mockTrigger).not.toHaveBeenCalled();
    });

    it("should resolve without throwing", async () => {
      await expect(
        triggerToChannel("ch", "ev", { data: 1 })
      ).resolves.toBeUndefined();
    });
  });
});
