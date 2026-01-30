import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";

export async function inventoryApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/inventory", async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; chain?: string } }>, reply) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const chainFilter = req.query.chain as string | undefined;
      const where = chainFilter ? { chain: chainFilter } : {};
      const [items, total] = await Promise.all([
        prisma.inventoryAsset.findMany({
          where,
          skip,
          take: limit,
          orderBy: { updatedAt: "desc" },
        }),
        prisma.inventoryAsset.count({ where }),
      ]);
      const data = items.map((a) => ({
        ...a,
        currentBalance: a.currentBalance.toString(),
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/inventory");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get(
    "/api/inventory/history",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; assetId?: string; chain?: string };
      }>,
      reply
    ) => {
      try {
        const { page, limit, skip } = parsePagination(req.query);
        const assetId = req.query.assetId as string | undefined;
        const chain = req.query.chain as string | undefined;
        const where: { assetId?: string; asset?: { chain: string } } = {};
        if (assetId) where.assetId = assetId;
        if (chain) where.asset = { chain };
        const [items, total] = await Promise.all([
          prisma.inventoryHistory.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { asset: { select: { id: true, chain: true, symbol: true } } },
          }),
          prisma.inventoryHistory.count({ where }),
        ]);
        const data = items.map((h) => ({
          ...h,
          amount: h.amount.toString(),
          quantity: h.quantity.toString(),
          initialPurchasePrice: h.initialPurchasePrice.toString(),
          providerQuotePrice: h.providerQuotePrice.toString(),
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/inventory/history");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/api/inventory/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const asset = await prisma.inventoryAsset.findUnique({
        where: { id: req.params.id },
      });
      if (!asset) return errorEnvelope(reply, "Inventory asset not found", 404);
      const data = { ...asset, currentBalance: asset.currentBalance.toString() };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/inventory/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  app.get("/api/inventory/:id/history", async (req: FastifyRequest<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>, reply) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const [items, total] = await Promise.all([
        prisma.inventoryHistory.findMany({
          where: { assetId: req.params.id },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.inventoryHistory.count({ where: { assetId: req.params.id } }),
      ]);
      const data = items.map((h) => ({
        ...h,
        amount: h.amount.toString(),
        quantity: h.quantity.toString(),
        initialPurchasePrice: h.initialPurchasePrice.toString(),
        providerQuotePrice: h.providerQuotePrice.toString(),
      }));
      return successEnvelopeWithMeta(reply, data, { page, limit, total });
    } catch (err) {
      req.log.error({ err }, "GET /api/inventory/:id/history");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
