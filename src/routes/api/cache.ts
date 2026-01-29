import type { FastifyInstance, FastifyRequest } from "fastify";
import { getBalance, listBalanceKeys } from "../../lib/redis.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";

export async function cacheApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cache/balances", async (req: FastifyRequest<{ Querystring: { limit?: string } }>, reply) => {
    try {
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
