/**
 * Platform API: overview and metrics for the platform (all transactions).
 * Platform key only. Use for the platform dashboard, not the Connect (B2B) dashboard.
 * Overview uses realized revenue (fee × USD at tx time) and breakdown by trading pair.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { getPlatformOverview } from "../../services/analytics.service.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ } from "../../lib/permissions.js";

type OverviewQuerystring = {
  startDate?: string;
  endDate?: string;
};

export async function platformApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/platform/overview ---
  // Optional: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (inclusive, UTC)
  app.get<{ Querystring: OverviewQuerystring }>(
    "/api/platform/overview",
    async (req: FastifyRequest<{ Querystring: OverviewQuerystring }>, reply) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;

        const { startDate, endDate } = req.query;
        const data = await getPlatformOverview({
          startDate: startDate ?? undefined,
          endDate: endDate ?? undefined,
        });

        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "GET /api/platform/overview");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
