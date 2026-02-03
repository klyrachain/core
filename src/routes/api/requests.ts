import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";

export async function requestsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/requests", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const { page, limit, skip } = parsePagination(req.query);
      const [items, total] = await Promise.all([
        prisma.request.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { transaction: true, claim: true },
        }),
        prisma.request.count(),
      ]);
      const data = items.map((r) => ({
        ...r,
        transaction: r.transaction
          ? {
            ...r.transaction,
            f_amount: r.transaction.f_amount.toString(),
            t_amount: r.transaction.t_amount.toString(),
            f_price: r.transaction.f_price.toString(),
            t_price: r.transaction.t_price.toString(),
          }
          : null,
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/requests");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/requests/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const request = await prisma.request.findUnique({
        where: { id: req.params.id },
        include: { transaction: true, claim: true },
      });
      if (!request) return errorEnvelope(reply, "Request not found", 404);
      const data = {
        ...request,
        transaction: request.transaction
          ? {
            ...request.transaction,
            f_amount: request.transaction.f_amount.toString(),
            t_amount: request.transaction.t_amount.toString(),
            f_price: request.transaction.f_price.toString(),
            t_price: request.transaction.t_price.toString(),
          }
          : null,
        claim: request.claim
          ? {
            ...request.claim,
            value: request.claim.value.toString(),
            price: request.claim.price.toString(),
          }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/requests/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
