import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";
import { getAverageCostBasis, getLotsForAsset } from "../../services/inventory.service.js";

function toDecimal(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function inventoryApiRoutes(app: FastifyInstance): Promise<void> {
  // --- POST /api/inventory (create) ---
  app.post(
    "/api/inventory",
    async (
      req: FastifyRequest<{
        Body: {
          chain?: string;
          chainId?: number;
          tokenAddress?: string;
          symbol?: string;
          address?: string;
          currentBalance?: number;
          walletId?: string | null;
        };
      }>,
      reply
    ) => {
      try {
        const body = req.body ?? {};
        const chain = String(body.chain ?? "").trim();
        const chainId = typeof body.chainId === "number" ? body.chainId : parseInt(String(body.chainId ?? ""), 10);
        const tokenAddress = String(body.tokenAddress ?? "").trim();
        const symbol = String(body.symbol ?? "").trim();
        const address = String(body.address ?? "").trim();
        const currentBalance = toDecimal(body.currentBalance);
        const walletId = body.walletId === null || body.walletId === "" ? null : (body.walletId as string) ?? null;

        if (!chain) return errorEnvelope(reply, "chain is required", 400);
        if (Number.isNaN(chainId)) return errorEnvelope(reply, "chainId is required and must be a number", 400);
        if (!tokenAddress) return errorEnvelope(reply, "tokenAddress is required", 400);
        if (!symbol) return errorEnvelope(reply, "symbol is required", 400);
        if (!address) return errorEnvelope(reply, "address is required", 400);

        const existing = await prisma.inventoryAsset.findUnique({
          where: {
            chainId_tokenAddress_address: { chainId, tokenAddress, address },
          },
        });
        if (existing) {
          return errorEnvelope(reply, "An inventory asset with this chainId, tokenAddress and address already exists", 409);
        }

        const asset = await prisma.inventoryAsset.create({
          data: {
            chain,
            chainId,
            tokenAddress,
            symbol,
            address,
            currentBalance,
            walletId,
          },
          include: { wallet: { select: { id: true, address: true } } },
        });
        const data = { ...asset, currentBalance: asset.currentBalance.toString() };
        return successEnvelope(reply, data, 201);
      } catch (err) {
        req.log.error({ err }, "POST /api/inventory");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get(
    "/api/inventory",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; chain?: string; chainId?: string; address?: string };
      }>,
      reply
    ) => {
      try {
        const { page, limit, skip } = parsePagination(req.query);
        const chainFilter = req.query.chain as string | undefined;
        const chainIdFilter = req.query.chainId != null ? parseInt(req.query.chainId as string, 10) : undefined;
        const addressFilter = (req.query.address as string)?.trim();
        const where: { chain?: string; chainId?: number; address?: string } = {};
        if (chainFilter) where.chain = chainFilter;
        if (!Number.isNaN(chainIdFilter)) where.chainId = chainIdFilter;
        if (addressFilter) where.address = addressFilter;
        const [items, total] = await Promise.all([
          prisma.inventoryAsset.findMany({
            where,
            skip,
            take: limit,
            orderBy: { updatedAt: "desc" },
            include: { wallet: { select: { id: true, address: true } } },
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
    }
  );

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
        const where: { assetId?: string; asset?: { chain?: string; chainId?: number; address?: string } } = {};
        if (assetId) where.assetId = assetId;
        if (chain) where.asset = { chain };
        const [items, total] = await Promise.all([
          prisma.inventoryHistory.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { asset: { select: { id: true, chain: true, chainId: true, symbol: true, address: true } } },
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
        include: { wallet: { select: { id: true, address: true } } },
      });
      if (!asset) return errorEnvelope(reply, "Inventory asset not found", 404);
      const data = { ...asset, currentBalance: asset.currentBalance.toString() };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/inventory/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- GET /api/inventory/:id/lots (FIFO order; for order-book style fulfillment) ---
  app.get(
    "/api/inventory/:id/lots",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: { onlyAvailable?: string };
      }>,
      reply
    ) => {
      try {
        const asset = await prisma.inventoryAsset.findUnique({ where: { id: req.params.id } });
        if (!asset) return errorEnvelope(reply, "Inventory asset not found", 404);
        const onlyAvailable = req.query.onlyAvailable === "true" || req.query.onlyAvailable === "1";
        const lots = await getLotsForAsset(req.params.id, { onlyAvailable });
        const data = lots.map((l) => ({
          id: l.id,
          quantity: l.quantity.toString(),
          costPerToken: l.costPerToken.toString(),
          acquiredAt: l.acquiredAt.toISOString(),
          sourceType: l.sourceType,
          sourceTransactionId: l.sourceTransactionId,
        }));
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "GET /api/inventory/:id/lots");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- GET /api/inventory/:id/cost-basis (volume-weighted avg for pricing engine floor) ---
  app.get("/api/inventory/:id/cost-basis", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const asset = await prisma.inventoryAsset.findUnique({ where: { id: req.params.id } });
      if (!asset) return errorEnvelope(reply, "Inventory asset not found", 404);
      const averageCostPerToken = await getAverageCostBasis(req.params.id);
      const data = {
        assetId: req.params.id,
        averageCostPerToken: averageCostPerToken == null ? null : averageCostPerToken.toString(),
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/inventory/:id/cost-basis");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  // --- PATCH /api/inventory/:id (update) ---
  app.patch(
    "/api/inventory/:id",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: {
          chain?: string;
          chainId?: number;
          tokenAddress?: string;
          symbol?: string;
          token?: string; // alias for symbol (e.g. frontend InventoryAssetRow.token)
          address?: string;
          currentBalance?: number;
          balance?: number; // alias for currentBalance (e.g. frontend sends balance)
          walletId?: string | null;
        };
      }>,
      reply
    ) => {
      try {
        const id = req.params.id;
        const existing = await prisma.inventoryAsset.findUnique({ where: { id } });
        if (!existing) return errorEnvelope(reply, "Inventory asset not found", 404);

        const body = req.body ?? {};
        const updates: {
          chain?: string;
          chainId?: number;
          tokenAddress?: string;
          symbol?: string;
          address?: string;
          currentBalance?: number;
          walletId?: string | null;
        } = {};

        if (body.chain !== undefined) updates.chain = String(body.chain).trim();
        if (body.chainId !== undefined) {
          const chainId = typeof body.chainId === "number" ? body.chainId : parseInt(String(body.chainId), 10);
          if (Number.isNaN(chainId)) return errorEnvelope(reply, "chainId must be a number", 400);
          updates.chainId = chainId;
        }
        if (body.tokenAddress !== undefined) updates.tokenAddress = String(body.tokenAddress).trim();
        const symbol = body.symbol ?? body.token;
        if (symbol !== undefined) updates.symbol = String(symbol).trim();
        if (body.address !== undefined) updates.address = String(body.address).trim();
        const balanceValue = body.currentBalance ?? body.balance;
        if (balanceValue !== undefined) updates.currentBalance = toDecimal(balanceValue);
        if (body.walletId !== undefined) updates.walletId = body.walletId === null || body.walletId === "" ? null : (body.walletId as string);

        const chainId = updates.chainId ?? existing.chainId;
        const tokenAddress = updates.tokenAddress ?? existing.tokenAddress;
        const address = updates.address ?? existing.address;
        const conflict = await prisma.inventoryAsset.findUnique({
          where: {
            chainId_tokenAddress_address: { chainId, tokenAddress, address },
          },
        });
        if (conflict && conflict.id !== id) {
          return errorEnvelope(reply, "Another inventory asset already exists with this chainId, tokenAddress and address", 409);
        }

        const asset = await prisma.inventoryAsset.update({
          where: { id },
          data: updates,
          include: { wallet: { select: { id: true, address: true } } },
        });
        const data = { ...asset, currentBalance: asset.currentBalance.toString() };
        return successEnvelope(reply, data);
      } catch (err) {
        req.log.error({ err }, "PATCH /api/inventory/:id");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  // --- DELETE /api/inventory/:id ---
  app.delete("/api/inventory/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const id = req.params.id;
      const existing = await prisma.inventoryAsset.findUnique({ where: { id } });
      if (!existing) return errorEnvelope(reply, "Inventory asset not found", 404);

      await prisma.$transaction([
        prisma.inventoryHistory.deleteMany({ where: { assetId: id } }),
        prisma.inventoryAsset.delete({ where: { id } }),
      ]);
      return successEnvelope(reply, { deleted: true, id }, 200);
    } catch (err) {
      req.log.error({ err }, "DELETE /api/inventory/:id");
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