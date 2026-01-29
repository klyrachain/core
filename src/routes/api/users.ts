import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";

export async function usersApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const [items, total] = await Promise.all([
        prisma.user.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, address: true, number: true, username: true, createdAt: true, updatedAt: true },
        }),
        prisma.user.count(),
      ]);
      return successEnvelopeWithMeta(reply, items, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/users");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/users/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { id: true, email: true, address: true, number: true, username: true, createdAt: true, updatedAt: true },
      });
      if (!user) return errorEnvelope(reply, "User not found", 404);
      return successEnvelope(reply, user);
    } catch (err) {
      req.log.error({ err }, "GET /api/users/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
