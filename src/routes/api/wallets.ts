import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";

const MASK = "***";

export async function walletsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wallets", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, reply) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const [items, total] = await Promise.all([
        prisma.wallet.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            address: true,
            encryptedKey: true,
            supportedTokens: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.wallet.count(),
      ]);
      const data = items.map((w) => ({
        ...w,
        encryptedKey: w.encryptedKey ? MASK : null,
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/wallets");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/wallets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const wallet = await prisma.wallet.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          address: true,
          encryptedKey: true,
          supportedTokens: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!wallet) return errorEnvelope(reply, "Wallet not found", 404);
      const data = { ...wallet, encryptedKey: wallet.encryptedKey ? MASK : null };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/wallets/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
