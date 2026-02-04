/**
 * Offramp: user sends crypto to our liquidity pool, we confirm and allow payout (Paystack).
 * - GET/calldata: return liquidity pool address + params for user to build transfer tx.
 * - POST confirm: accept tx_hash, verify (stub or RPC), add to inventory, set Transaction COMPLETED.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../../lib/prisma.js";
import { getLiquidityPoolWallet } from "../../services/liquidity-pool.service.js";
import { findPoolTokenFromDb } from "../../services/supported-token.service.js";
import { addInventory } from "../../services/inventory.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
};

const CalldataQuerySchema = z.object({
  transaction_id: z.string().uuid(),
});

const ConfirmBodySchema = z.object({
  transaction_id: z.string().uuid(),
  tx_hash: z.string().min(1),
});

export async function offrampApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Get calldata / destination for user to send crypto to our liquidity pool.
   * Returns toAddress (liquidity pool), chainId, token, amount (human), tokenAddress for building tx.
   */
  app.get(
    "/api/offramp/calldata",
    async (req: FastifyRequest<{ Querystring: { transaction_id?: string } }>, reply) => {
      if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
      const parse = CalldataQuerySchema.safeParse({ transaction_id: req.query.transaction_id });
      if (!parse.success) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          details: parse.error.flatten(),
        });
      }
      const tx = await prisma.transaction.findUnique({
        where: { id: parse.data.transaction_id },
        select: { id: true, type: true, status: true, f_chain: true, f_token: true, f_amount: true },
      });
      if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
      if (tx.type !== "SELL") return reply.status(400).send({ success: false, error: "Transaction must be SELL" });
      if (tx.status === "COMPLETED") {
        return reply.status(400).send({ success: false, error: "Transaction already completed" });
      }

      const pool = await getLiquidityPoolWallet(tx.f_chain);
      if (!pool) return errorEnvelope(reply, "No liquidity pool for this chain", 503);

      const chainId = CHAIN_NAME_TO_ID[tx.f_chain?.toUpperCase() ?? ""] ?? 8453;
      const poolToken = await findPoolTokenFromDb(chainId, tx.f_token);
      if (!poolToken) return errorEnvelope(reply, `Unsupported token ${tx.f_token}`, 400);

      return successEnvelope(reply, {
        toAddress: pool.address,
        chainId,
        chain: tx.f_chain,
        token: tx.f_token,
        tokenAddress: poolToken.address,
        amount: tx.f_amount.toString(),
        decimals: poolToken.decimals ?? 18,
        message: "User must send this amount of f_token to toAddress; then call POST /api/offramp/confirm with tx_hash",
      });
    }
  );

  /**
   * Confirm offramp: frontend sends tx_hash; we verify (stub) and credit liquidity pool inventory, set COMPLETED.
   * Real implementation would verify on-chain that tx sent amount to our pool address.
   */
  app.post<{ Body: unknown }>("/api/offramp/confirm", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
    const parse = ConfirmBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const { transaction_id, tx_hash } = parse.data;

    const tx = await prisma.transaction.findUnique({
      where: { id: transaction_id },
      select: {
        id: true,
        type: true,
        status: true,
        f_chain: true,
        f_token: true,
        f_amount: true,
        f_tokenPriceUsd: true,
      },
    });
    if (!tx) return errorEnvelope(reply, "Transaction not found", 404);
    if (tx.type !== "SELL") return reply.status(400).send({ success: false, error: "Transaction must be SELL" });
    if (tx.status === "COMPLETED") {
      return successEnvelope(reply, { confirmed: true, transaction_id, message: "Already completed" });
    }

    const pool = await getLiquidityPoolWallet(tx.f_chain);
    if (!pool) return errorEnvelope(reply, "No liquidity pool for this chain", 503);

    const chainId = CHAIN_NAME_TO_ID[tx.f_chain?.toUpperCase() ?? ""] ?? 8453;
    const poolToken = await findPoolTokenFromDb(chainId, tx.f_token);
    if (!poolToken) return errorEnvelope(reply, `Unsupported token ${tx.f_token}`, 400);

    // TODO: verify on-chain that tx_hash sent tx.f_amount of tx.f_token to pool.address; if not, return 400
    // For now we trust the client and credit inventory with USD cost basis
    const amount = new Decimal(tx.f_amount);
    const costPerTokenUsd = tx.f_tokenPriceUsd != null && Number(tx.f_tokenPriceUsd) > 0 ? Number(tx.f_tokenPriceUsd) : 1;

    try {
      await addInventory({
        chain: tx.f_chain,
        chainId,
        tokenAddress: poolToken.address,
        symbol: tx.f_token,
        amount,
        address: pool.address.toLowerCase(),
        type: "PURCHASE",
        costPerTokenUsd,
        sourceTransactionId: transaction_id,
      });
    } catch (err) {
      req.log.error({ err, transaction_id }, "Offramp addInventory failed");
      return errorEnvelope(reply, "Failed to credit inventory", 500);
    }

    await prisma.transaction.update({
      where: { id: transaction_id },
      data: { status: "COMPLETED" },
    });

    return successEnvelope(reply, {
      confirmed: true,
      transaction_id,
      tx_hash,
      message: "Transaction completed. User can request payout via POST /api/paystack/payouts/request.",
    });
  });
}
