/**
 * Offramp: user sends crypto to our liquidity pool, we confirm and allow payout (Paystack).
 * - GET/calldata: return liquidity pool address + params for user to build transfer tx.
 * - POST confirm: accept tx_hash, verify (stub or RPC), add to inventory, set Transaction COMPLETED.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { parseUnits } from "viem";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../../lib/prisma.js";
import { buildOfframpCalldataForTransaction } from "../../services/offramp-calldata.service.js";
import { getLiquidityPoolWallet } from "../../services/liquidity-pool.service.js";
import { findPoolTokenFromDb } from "../../services/supported-token.service.js";
import { addInventory } from "../../services/inventory.service.js";
import { verifyTransactionByHash, transferMatches } from "../../services/transaction-verify.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  "BASE SEPOLIA": 84532,
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
      const built = await buildOfframpCalldataForTransaction(parse.data.transaction_id);
      if (!built.ok) {
        return reply.status(built.status).send({ success: false, error: built.error });
      }
      return successEnvelope(reply, {
        ...built.data,
        message:
          "User must send this amount of f_token to toAddress; then call POST /api/offramp/confirm with tx_hash",
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
        createdAt: true,
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
    if (!pool) {
      return reply.status(503).send({
        success: false,
        error: `No liquidity pool wallet for chain "${tx.f_chain}". Add a Wallet with isLiquidityPool=true and supportedChains including "${tx.f_chain}" (e.g. BASE or BASE SEPOLIA). The pool is the Wallet that receives crypto, not an InventoryAsset.`,
      });
    }

    const chainId = CHAIN_NAME_TO_ID[tx.f_chain?.toUpperCase().replace(/-/g, " ") ?? ""] ?? CHAIN_NAME_TO_ID[tx.f_chain?.toUpperCase() ?? ""] ?? 8453;
    const poolToken = await findPoolTokenFromDb(chainId, tx.f_token);
    if (!poolToken) return errorEnvelope(reply, `Unsupported token ${tx.f_token}`, 400);

    const verify = await verifyTransactionByHash(chainId, tx_hash);
    if (!verify.ok) {
      return reply.status(400).send({ success: false, error: `On-chain verification failed: ${verify.error}` });
    }
    if (verify.status !== "success") {
      return reply.status(400).send({ success: false, error: "Transaction reverted on-chain" });
    }
    const decimals = poolToken.decimals ?? 18;
    const expectedAmountWei = parseUnits(tx.f_amount.toString(), decimals);
    if (!transferMatches(verify.transfers, poolToken.address, pool.address, expectedAmountWei)) {
      return reply.status(400).send({
        success: false,
        error: `No ERC20 Transfer to pool ${pool.address} for token ${poolToken.address} with amount >= ${tx.f_amount} (${expectedAmountWei} raw). Check tx hash and that you sent to the calldata toAddress.`,
      });
    }

    // Reject tx mined before order creation (replay protection: only tx created after calldata/order is valid).
    const orderCreatedAtSeconds = Math.floor(tx.createdAt.getTime() / 1000);
    const CLOCK_SKEW_SECONDS = 60;
    if (verify.blockTimestamp < orderCreatedAtSeconds - CLOCK_SKEW_SECONDS) {
      return reply.status(400).send({
        success: false,
        error:
          "Transaction was mined before this order was created. Only transactions executed after receiving the calldata for this order are accepted (replay protection).",
      });
    }

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
