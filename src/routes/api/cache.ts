import type { FastifyInstance, FastifyRequest } from "fastify";
import { getBalance, listBalanceKeys } from "../../lib/redis.js";
import { syncAllInventoryBalancesToRedis } from "../../services/inventory.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ, PERMISSION_VALIDATION_WRITE } from "../../lib/permissions.js";

export async function cacheApiRoutes(app: FastifyInstance): Promise<void> {
  /** Sync all inventory assets to Redis (so balance cache has current DB state). Use before live tests. */
  app.post("/api/cache/sync-balances", async (req, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_VALIDATION_WRITE)) return;
      const { synced } = await syncAllInventoryBalancesToRedis();
      return successEnvelope(reply, { synced }, 200);
    } catch (err) {
      req.log.error({ err }, "POST /api/cache/sync-balances");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/cache/balances", async (req: FastifyRequest<{ Querystring: { limit?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "50", 10) || 50));
      const items = await listBalanceKeys(limit);
      return successEnvelope(reply, items);
    } catch (err) {
      req.log.error({ err }, "GET /api/cache/balances");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/cache/balances/:chain/:token", async (req: FastifyRequest<{ Params: { chain: string; token: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const { chain, token } = req.params;
      const entry = await getBalance(chain, token);
      if (!entry) return errorEnvelope(reply, "Balance not found or expired", 404);
      return successEnvelope(reply, { chain, token, ...entry });
    } catch (err) {
      req.log.error({ err }, "GET /api/cache/balances/:chain/:token");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
