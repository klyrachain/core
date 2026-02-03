/**
 * Platform API: overview and metrics for the platform (all transactions).
 * Platform key only. Use for the platform dashboard, not the Connect (B2B) dashboard.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { getAccumulatedFees } from "./connect.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_PLATFORM_READ } from "../../lib/permissions.js";

const COMPLETED_STATUS = "COMPLETED";

export async function platformApiRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /api/platform/overview ---
  app.get("/api/platform/overview", async (req: FastifyRequest, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_PLATFORM_READ)) return;

      // All completed transactions (no business filter) — platform-wide fee accumulation
      const { byCurrency: feesByCurrency, totalConverted } = await getAccumulatedFees({});

      const completedCount = await prisma.transaction.count({
        where: { status: COMPLETED_STATUS },
      });

      const completedWithFee = await prisma.transaction.aggregate({
        where: { status: COMPLETED_STATUS, fee: { not: null } },
        _count: { id: true },
        _sum: { fee: true },
      });

      return successEnvelope(reply, {
        feesByCurrency,
        totalConverted: Math.round(totalConverted * 1e8) / 1e8,
        completedTransactionCount: completedCount,
        completedWithFeeCount: completedWithFee._count.id ?? 0,
      });
    } catch (err) {
      req.log.error({ err }, "GET /api/platform/overview");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
