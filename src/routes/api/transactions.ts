import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  parsePagination,
  successEnvelope,
  successEnvelopeWithMeta,
  errorEnvelope,
  serializeTransactionPrices,
} from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import { verifyTransactionByHash } from "../../services/transaction-verify.service.js";
import { getOptionalMerchantBusinessId } from "../../lib/business-portal-tenant.guard.js";
import { getMerchantEnvironmentOrThrow } from "../../lib/merchant-environment.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  "BASE SEPOLIA": 84532,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
};

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
        const merchantBid = getOptionalMerchantBusinessId(req);
        const merchantEnv = getMerchantEnvironmentOrThrow(req);
        const where =
          status || type || merchantBid
            ? {
                ...(status
                  ? {
                      status: status as
                        | "ACTIVE"
                        | "PENDING"
                        | "COMPLETED"
                        | "CANCELLED"
                        | "FAILED",
                    }
                  : {}),
                ...(type
                  ? { type: type as "BUY" | "SELL" | "TRANSFER" | "REQUEST" | "CLAIM" }
                  : {}),
                ...(merchantBid
                  ? { businessId: merchantBid, environment: merchantEnv }
                  : {}),
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
        const data = items.map((t) => {
          const { peerRampEscrowFundingTxHash: _prEscrow, ...rest } = t;
          return {
            ...rest,
            f_amount: t.f_amount.toString(),
            t_amount: t.t_amount.toString(),
            ...serializeTransactionPrices(t),
            fee: t.fee != null ? t.fee.toString() : null,
            platformFee: t.platformFee != null ? t.platformFee.toString() : null,
            merchantFee: t.merchantFee != null ? t.merchantFee.toString() : null,
            providerPrice: t.providerPrice != null ? t.providerPrice.toString() : null,
          };
        });
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/transactions");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /**
   * GET /api/transactions/verify-by-hash?chain=BASE&tx_hash=0x... (or chainId=84532)
   * Returns full on-chain tx data + receipt + parsed ERC20 Transfer events.
   * Use to verify that a tx sent expected amount to an address (e.g. offramp: user → pool).
   */
  app.get(
    "/api/transactions/verify-by-hash",
    async (
      req: FastifyRequest<{
        Querystring: { chain?: string; chainId?: string; tx_hash: string };
      }>,
      reply
    ) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      const schema = z.object({
        tx_hash: z.string().min(1),
        chain: z.string().optional(),
        chainId: z.coerce.number().optional(),
      });
      const parse = schema.safeParse({
        tx_hash: req.query.tx_hash?.trim(),
        chain: req.query.chain?.trim(),
        chainId: req.query.chainId != null ? Number(req.query.chainId) : undefined,
      });
      if (!parse.success) {
        return reply.status(400).send({ success: false, error: "tx_hash required; chain or chainId required", details: parse.error.flatten() });
      }
      const { tx_hash, chain, chainId } = parse.data;
      let resolvedChainId: number | undefined = chainId;
      if (resolvedChainId == null && chain) {
        const name = chain.toUpperCase().replace(/-/g, " ");
        resolvedChainId = CHAIN_NAME_TO_ID[name] ?? CHAIN_NAME_TO_ID[chain.toUpperCase()];
      }
      if (resolvedChainId == null) {
        return reply.status(400).send({
          success: false,
          error: "Provide chain (e.g. BASE, BASE SEPOLIA) or chainId (e.g. 8453, 84532)",
        });
      }
      const result = await verifyTransactionByHash(resolvedChainId, tx_hash);
      if (!result.ok) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      return successEnvelope(reply, {
        chainId: result.chainId,
        hash: result.hash,
        blockNumber: String(result.blockNumber),
        blockTimestamp: result.blockTimestamp,
        status: result.status,
        from: result.from,
        to: result.to,
        transfers: result.transfers,
        receipt: result.receipt,
      });
    }
  );

  app.get("/api/transactions/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const merchantBid = getOptionalMerchantBusinessId(req);
      const merchantEnv = getMerchantEnvironmentOrThrow(req);
      const tx = await prisma.transaction.findFirst({
        where: merchantBid
          ? { id: req.params.id, businessId: merchantBid, environment: merchantEnv }
          : { id: req.params.id },
        include: {
          fromUser: { select: { id: true, email: true, address: true, username: true } },
          toUser: { select: { id: true, email: true, address: true, username: true } },
          request: true,
        },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
      const { peerRampEscrowFundingTxHash: _prEscrow, ...txRest } = tx;
      const data = {
        ...txRest,
        f_amount: tx.f_amount.toString(),
        t_amount: tx.t_amount.toString(),
        ...serializeTransactionPrices(tx),
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
        include: { lot: { select: { id: true, remainingQuantity: true, costPerTokenUsd: true, acquiredAt: true, assetId: true } } },
      });
      const data = pnls.map((p) => ({
        id: p.id,
        transactionId: p.transactionId,
        lotId: p.lotId,
        quantity: p.quantity.toString(),
        costPerTokenUsd: p.costPerTokenUsd.toString(),
        feeAmountUsd: p.feeAmountUsd.toString(),
        profitLossUsd: p.profitLossUsd.toString(),
        lot: p.lot
          ? {
            ...p.lot,
            remainingQuantity: p.lot.remainingQuantity.toString(),
            costPerTokenUsd: p.lot.costPerTokenUsd.toString(),
          }
          : null,
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
              lot: { select: { id: true, assetId: true, remainingQuantity: true, costPerTokenUsd: true } },
            },
          }),
          prisma.transactionPnL.count({ where }),
        ]);
        const data = items.map((p) => ({
          id: p.id,
          transactionId: p.transactionId,
          lotId: p.lotId,
          quantity: p.quantity.toString(),
          costPerTokenUsd: p.costPerTokenUsd.toString(),
          feeAmountUsd: p.feeAmountUsd.toString(),
          profitLossUsd: p.profitLossUsd.toString(),
          transaction: p.transaction,
          lot: p.lot
            ? {
              ...p.lot,
              remainingQuantity: p.lot.remainingQuantity.toString(),
              costPerTokenUsd: p.lot.costPerTokenUsd.toString(),
            }
            : null,
        }));
        return successEnvelopeWithMeta(reply, data, { page, limit, total });
      } catch (err) {
        req.log.error({ err }, "GET /api/pnl");
        return errorEnvelope(reply, "Something went wrong.", 500);
      }
    }
  );

  /** GET /api/transactions/:id/balance-snapshots — balance before/after per asset for this transaction. */
  app.get("/api/transactions/:id/balance-snapshots", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS)) return;
      const snapshots = await prisma.transactionBalanceSnapshot.findMany({
        where: { transactionId: req.params.id },
        orderBy: { createdAt: "asc" },
        include: { asset: { select: { id: true, chain: true, chainId: true, symbol: true, tokenAddress: true, address: true } } },
      });
      const data = snapshots.map((s) => ({
        id: s.id,
        transactionId: s.transactionId,
        assetId: s.assetId,
        balanceBefore: s.balanceBefore.toString(),
        balanceAfter: s.balanceAfter.toString(),
        createdAt: s.createdAt.toISOString(),
        asset: s.asset,
      }));
      return successEnvelope(reply, data);
    } catch (err) {
      req.log.error({ err }, "GET /api/transactions/:id/balance-snapshots");
      return errorEnvelope(reply, "Something went wrong.", 500);
    }
  });
}
