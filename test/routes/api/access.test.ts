import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { accessApiRoutes } from "../../../src/routes/api/access.js";

const mockFindUnique = vi.fn();

vi.mock("../../../src/lib/prisma.js", () => ({
  prisma: {
    business: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

type ApiKeyContext = {
  id: string;
  name: string;
  permissions: string[];
  businessId: string | null;
} | null;

describe("GET /api/access", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let apiKeyContext: ApiKeyContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    apiKeyContext = null;
    app = Fastify();
    app.addHook("preHandler", (req, _reply, done) => {
      (req as { apiKey?: ApiKeyContext }).apiKey = apiKeyContext;
      done();
    });
    await app.register(accessApiRoutes, { prefix: "" });
  });

  it("returns 401 when apiKey is not set", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/access",
    });
    expect(res.statusCode).toBe(401);
    const json = res.json() as { success: boolean; error: string };
    expect(json.success).toBe(false);
    expect(json.error).toBe("Not authenticated.");
  });

  it("returns 200 with type platform when apiKey has no businessId", async () => {
    apiKeyContext = {
      id: "key-platform-1",
      name: "Platform Admin",
      permissions: ["*"],
      businessId: null,
    };
    const res = await app.inject({
      method: "GET",
      url: "/api/access",
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { success: boolean; data: { type: string; key: unknown } };
    expect(json.success).toBe(true);
    expect(json.data.type).toBe("platform");
    expect(json.data.key).toEqual({
      id: "key-platform-1",
      name: "Platform Admin",
      permissions: ["*"],
    });
    expect(json.data).not.toHaveProperty("business");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 200 with type merchant and business when business exists", async () => {
    apiKeyContext = {
      id: "key-merchant-1",
      name: "Merchant Backend",
      permissions: ["READ_ONLY", "ADMIN"],
      businessId: "biz-acme-1",
    };
    mockFindUnique.mockResolvedValue({
      id: "biz-acme-1",
      name: "Acme Inc",
      slug: "acme",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/access",
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      success: boolean;
      data: { type: string; key: unknown; business?: { id: string; name: string; slug: string } };
    };
    expect(json.success).toBe(true);
    expect(json.data.type).toBe("merchant");
    expect(json.data.key).toEqual({
      id: "key-merchant-1",
      name: "Merchant Backend",
      permissions: ["READ_ONLY", "ADMIN"],
    });
    expect(json.data.business).toEqual({ id: "biz-acme-1", name: "Acme Inc", slug: "acme" });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "biz-acme-1" },
      select: { id: true, name: true, slug: true },
    });
  });

  it("returns 200 with type merchant and no business when business not found", async () => {
    apiKeyContext = {
      id: "key-merchant-2",
      name: "Orphan Key",
      permissions: ["READ_ONLY"],
      businessId: "biz-deleted",
    };
    mockFindUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/access",
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { success: boolean; data: { type: string; business?: unknown } };
    expect(json.success).toBe(true);
    expect(json.data.type).toBe("merchant");
    expect(json.data.business).toBeUndefined();
  });
});
