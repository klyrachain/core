import type { FastifyInstance, FastifyRequest } from "fastify";
import { getPollQueue } from "../../lib/queue.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ } from "../../lib/permissions.js";

export async function queueApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/queue/poll", async (req: FastifyRequest<{ Querystring: { limit?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;
      const queue = getPollQueue();
      const [counts, waiting, active] = await Promise.all([
        queue.getJobCounts(),
        queue.getJobs(["waiting"], 0, Math.min(50, parseInt(req.query.limit ?? "20", 10) || 20)),
        queue.getJobs(["active"], 0, Math.min(50, parseInt(req.query.limit ?? "20", 10) || 20)),
      ]);
      const data = {
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: counts.paused ?? 0,
        },
        recentWaiting: waiting.map((job) => ({
          id: job.id,
          data: job.data,
          timestamp: job.timestamp,
        })),
        recentActive: active.map((job) => ({
          id: job.id,
          data: job.data,
          timestamp: job.timestamp,
        })),
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/queue/poll");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
