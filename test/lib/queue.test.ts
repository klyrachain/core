import { describe, it, expect, beforeEach, vi } from "vitest";
import { addPollJob } from "../../src/lib/queue.js";

const mockAdd = vi.fn();

vi.mock("../../src/lib/redis.js", () => ({
  getRedis: () => ({}),
  getRedisConnectionForWorker: () => ({}),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockAdd,
  })),
  Worker: vi.fn(),
}));

describe("queue", () => {
  beforeEach(() => {
    mockAdd.mockReset();
    vi.resetModules();
  });

  describe("addPollJob", () => {
    it("should add a job with transactionId and jobId equal to transactionId", async () => {
      mockAdd.mockResolvedValue({ id: "tx-123", data: { transactionId: "tx-123" } });
      const job = await addPollJob("tx-123");
      expect(mockAdd).toHaveBeenCalledWith("process", { transactionId: "tx-123" }, { jobId: "tx-123" });
      expect(job).toEqual({ id: "tx-123", data: { transactionId: "tx-123" } });
    });
  });
});
