import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { parsePagination, successEnvelope, successEnvelopeWithMeta, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";

export async function transactionsApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/transactions",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; status?: string; type?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.status as string | undefined;
        const type = req.query.type as string | undefined;
        const where =
          status || type
            ? {
              ...(status ? { status: status as "ACTIVE" | "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED" } : {}),
              ...(type ? { type: type as "BUY" | "SELL" | "TRANSFER" | "REQUEST" | "CLAIM" } : {}),
            }
            : {};
        const [items, total] = await Promise.all([
          prisma.transaction.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              fromUser: { select: { id: true, email: true, username: true } },
              toUser: { select: { id: true, email: true, username: true } },
            },
          }),
          prisma.transaction.count({ where }),
        ]);
        const data = items.map((t) => ({
          ...t,
          f_amount: t.f_amount.toString(),
          t_amount: t.t_amount.toString(),
          f_price: t.f_price.toString(),
          t_price: t.t_price.toString(),
          fee: t.fee != null ? t.fee.toString() : null,
          platformFee: t.platformFee != null ? t.platformFee.toString() : null,
          merchantFee: t.merchantFee != null ? t.merchantFee.toString() : null,
          providerPrice: t.providerPrice != null ? t.providerPrice.toString() : null,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/transactions");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  app.get("/api/transactions/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const tx = await prisma.transaction.findUnique({
        where: { id: req.params.id },
        include: {
          fromUser: { select: { id: true, email: true, address: true, username: true } },
          toUser: { select: { id: true, email: true, address: true, username: true } },
          request: true,
        },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
      const data = {
        ...tx,
        f_amount: tx.f_amount.toString(),
        t_amount: tx.t_amount.toString(),
        f_price: tx.f_price.toString(),
        t_price: tx.t_price.toString(),
        fee: tx.fee != null ? tx.fee.toString() : null,
        platformFee: tx.platformFee != null ? tx.platformFee.toString() : null,
        merchantFee: tx.merchantFee != null ? tx.merchantFee.toString() : null,
        providerPrice: tx.providerPrice != null ? tx.providerPrice.toString() : null,
      };
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/transactions/:id");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** GET /api/transactions/:id/pnl — PnL rows for a transaction (FIFO lot attribution). */
  app.get("/api/transactions/:id/pnl", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const pnls = await prisma.transactionPnL.findMany({
        where: { transactionId: req.params.id },
        orderBy: { createdAt: "asc" },
        include: { lot: { select: { id: true, quantity: true, costPerToken: true, acquiredAt: true, assetId: true } } },
      });
      const data = pnls.map((p) => ({
        id: p.id,
        transactionId: p.transactionId,
        lotId: p.lotId,
        quantity: p.quantity.toString(),
        costPerToken: p.costPerToken.toString(),
        providerPrice: p.providerPrice.toString(),
        sellingPrice: p.sellingPrice.toString(),
        feeAmount: p.feeAmount.toString(),
        profitLoss: p.profitLoss.toString(),
        lot: p.lot,
      }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/transactions/:id/pnl");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });

  /** GET /api/pnl — list PnL rows with pagination; optional filter by transactionId. */
  app.get(
    "/api/pnl",
    async (
      req: FastifyRequest<{
        Querystring: { page?: string; limit?: string; transactionId?: string };
      }>,
      reply
    ) => {
      try {
        if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
        const { page, limit, skip } = parsePagination(req.query);
        const transactionId = (req.query.transactionId as string)?.trim();
        const where = transactionId ? { transactionId } : {};
        const [items, total] = await Promise.all([
          prisma.transactionPnL.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              transaction: { select: { id: true, type: true, status: true, f_chain: true, t_chain: true, f_token: true, t_token: true } },
              lot: { select: { id: true, assetId: true, quantity: true, costPerToken: true } },
            },
          }),
          prisma.transactionPnL.count({ where }),
        ]);
        const data = items.map((p) => ({
          id: p.id,
          transactionId: p.transactionId,
          lotId: p.lotId,
          quantity: p.quantity.toString(),
          costPerToken: p.costPerToken.toString(),
          providerPrice: p.providerPrice.toString(),
          sellingPrice: p.sellingPrice.toString(),
          feeAmount: p.feeAmount.toString(),
          profitLoss: p.profitLoss.toString(),
          transaction: p.transaction,
          lot: p.lot,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/pnl");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );
}
