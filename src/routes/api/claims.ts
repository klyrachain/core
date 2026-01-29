import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";

export async function claimsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/claims", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; status?: string } }>, reply) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const status = req.query.status as string | undefined;
      const where = status ? { status: status as "ACTIVE" | "CLAIMED" | "CANCELLED" | "FAIL" } : {};
      const [items, total] = await Promise.all([
        prisma.claim.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { request: { include: { transaction: true } } },
        }),
        prisma.claim.count({ where }),
      ]);
      const data = items.map((c) => ({
        ...c,
        value: c.value.toString(),
        price: c.price.toString(),
        request: c.request
          ? {
              ...c.request,
              transaction: c.request.transaction
                ? {
                    ...c.request.transaction,
                    f_amount: c.request.transaction.f_amount.toString(),
                    t_amount: c.request.transaction.t_amount.toString(),
                    f_price: c.request.transaction.f_price.toString(),
                    t_price: c.request.transaction.t_price.toString(),
                  }
                : null,
            }
          : null,
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/claims");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/claims/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const claim = await prisma.claim.findUnique({
        where: { id: req.params.id },
        include: { request: { include: { transaction: true } } },
      });
      if (!claim) return errorEnvelope(reply, "Claim not found", 404);
      const data = {
        ...claim,
        value: claim.value.toString(),
        price: claim.price.toString(),
        request: claim.request
          ? {
              ...claim.request,
              transaction: claim.request.transaction
                ? {
                    ...claim.request.transaction,
                    f_amount: claim.request.transaction.f_amount.toString(),
                    t_amount: claim.request.transaction.t_amount.toString(),
                    f_price: claim.request.transaction.f_price.toString(),
                    t_price: claim.request.transaction.t_price.toString(),
                  }
                : null,
            }
          : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/claims/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
