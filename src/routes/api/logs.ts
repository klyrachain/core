import type { FastifyInstance, FastifyRequest } from "fastify";
import { getRequestLogs } from "../../lib/request-log-store.js";
import { parsePagination, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";
import { sendToAdminDashboard } from "../../services/admin-dashboard.service.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ } from "../../lib/permissions.js";

export async function logsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/logs",
    async (
      req: FastifyRequest<{
        Querystring: {
          page?: string;
          limit?: string;
          method?: string;
          path?: string;
          since?: string;
        };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
        const { page, limit, skip } = parsePagination({
          page: req.query.page,
          limit: req.query.limit ?? "50",
        });
        const { entries, total } = getRequestLogs({
          method: req.query.method,
          path: req.query.path,
          since: req.query.since,
          limit,
          offset: skip,
        });

        const meta = { page, limit, total };
        const filters = {
          method: req.query.method,
          path: req.query.path,
          since: req.query.since,
          page,
          limit,
        };

        await sendToAdminDashboard({
          event: "logs.viewed",
          data: {
            success: true,
            data: entries,
            meta,
            filters,
            requestLogId: req.requestLogId,
          },
        }).catch((err) => req.log.warn({ err }, "Admin webhook logs.viewed failed"));

        return successEnvelopeWithMeta(reply, entries, meta);
      } catch (err) {
        req.log.error({ err }, "GET /api/logs");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
