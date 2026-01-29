import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { logsApiRoutes } from "../../../src/routes/api/logs.js";
import * as requestLogStore from "../../../src/lib/request-log-store.js";
import * as adminDashboard from "../../../src/services/admin-dashboard.service.js";

vi.mock("../../../src/lib/request-log-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof requestLogStore>();
  return {
    ...actual,
    getRequestLogs: vi.fn(),
  };
});

vi.mock("../../../src/services/admin-dashboard.service.js", () => ({
  sendToAdminDashboard: vi.fn().mockResolvedValue(undefined),
}));

const mockGetRequestLogs = vi.mocked(requestLogStore.getRequestLogs);
const mockSendToAdminDashboard = vi.mocked(adminDashboard.sendToAdminDashboard);

describe("GET /api/logs", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    mockGetRequestLogs.mockReset();
    mockSendToAdminDashboard.mockClear();
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (e) {
        done(e as Error, undefined);
      }
    });
    await app.register(logsApiRoutes, { prefix: "" });
  });

  it("should return logs with pagination and meta", async () => {
    const entries = [
      {
        id: "req_1",
        timestamp: new Date().toISOString(),
        method: "GET",
        path: "/health",
        query: {},
        headers: { "content-type": "application/json" },
        body: null,
        statusCode: 200,
        responseTimeMs: 1,
      },
    ];
    mockGetRequestLogs.mockReturnValue({ entries, total: 1 });

    const res = await app.inject({
      method: "GET",
      url: "/api/logs?page=1&limit=20",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as { success: boolean; data: unknown[]; meta: { page: number; limit: number; total: number } };
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({ id: "req_1", method: "GET", path: "/health" });
    expect(json.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(mockGetRequestLogs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 })
    );
  });

  it("should pass method and path filters to getRequestLogs", async () => {
    mockGetRequestLogs.mockReturnValue({ entries: [], total: 0 });

    await app.inject({
      method: "GET",
      url: "/api/logs?method=POST&path=webhook&since=2025-01-01T00:00:00Z",
    });

    expect(mockGetRequestLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "webhook",
        since: "2025-01-01T00:00:00Z",
      })
    );
  });

  it("should send webhook to admin dashboard with full response data", async () => {
    const entries = [
      {
        id: "req_2",
        timestamp: new Date().toISOString(),
        method: "GET",
        path: "/api/logs",
        query: { page: "1", limit: "10" },
        headers: {},
        body: null,
        statusCode: 200,
        responseTimeMs: 5,
      },
    ];
    mockGetRequestLogs.mockReturnValue({ entries, total: 1 });

    await app.inject({
      method: "GET",
      url: "/api/logs?page=1&limit=10&method=GET&path=api",
    });

    expect(mockSendToAdminDashboard).toHaveBeenCalledTimes(1);
    const call = mockSendToAdminDashboard.mock.calls[0]?.[0];
    expect(call?.event).toBe("logs.viewed");
    expect(call?.data).toBeDefined();
    expect(call?.data.success).toBe(true);
    expect(call?.data.data).toEqual(entries);
    expect(call?.data.meta).toEqual({ page: 1, limit: 10, total: 1 });
    expect(call?.data.filters?.method).toBe("GET");
    expect(call?.data.filters?.path).toBe("api");
    expect(call?.data.filters?.page).toBe(1);
    expect(call?.data.filters?.limit).toBe(10);
    expect(Object.prototype.hasOwnProperty.call(call?.data ?? {}, "requestLogId")).toBe(true);
  });
});
