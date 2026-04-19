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
import { addInventory } from "../../services/inventory.service.js";
import { verifyTransactionByHash, transferMatches } from "../../services/transaction-verify.service.js";
import { successEnvelope, errorEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import { isEvmConfirmableInstruction } from "../../services/payment-instruction.service.js";

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
   * Returns a discriminated `kind` payload (evm_erc20_transfer, solana_spl_transfer, …).
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
      const data = built.data;
      const baseMessage =
        data.kind === "evm_erc20_transfer"
          ? "User must send this amount of f_token to toAddress; then call POST /api/offramp/confirm with tx_hash"
          : "Follow the instruction for this chain. Automatic POST /api/offramp/confirm is only supported for evm_erc20_transfer today.";
      return successEnvelope(reply, {
        ...data,
        message: baseMessage,
      });
    }
  );

  /**
   * Confirm offramp: frontend sends tx_hash; we verify on-chain for EVM ERC-20 only.
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

    const built = await buildOfframpCalldataForTransaction(transaction_id);
    if (!built.ok) {
      return reply.status(built.status).send({ success: false, error: built.error });
    }
    const instruction = built.data;

    if (!isEvmConfirmableInstruction(instruction)) {
      return reply.status(501).send({
        success: false,
        error:
          "Automatic on-chain confirmation is only implemented for EVM ERC-20 transfers. Use manual settlement for this instruction kind until a chain verifier is added.",
        code: "OFFRAMP_CONFIRM_NOT_IMPLEMENTED",
        kind: instruction.kind,
      });
    }

    const chainId = instruction.chainId;
    const poolAddress = instruction.toAddress;
    const poolTokenAddress = instruction.tokenAddress;
    const decimals = instruction.decimals ?? 18;

    const verify = await verifyTransactionByHash(chainId, tx_hash);
    if (!verify.ok) {
      return reply.status(400).send({ success: false, error: `On-chain verification failed: ${verify.error}` });
    }
    if (verify.status !== "success") {
      return reply.status(400).send({ success: false, error: "Transaction reverted on-chain" });
    }
    const expectedAmountWei = parseUnits(tx.f_amount.toString(), decimals);
    if (!transferMatches(verify.transfers, poolTokenAddress, poolAddress, expectedAmountWei)) {
      return reply.status(400).send({
        success: false,
        error: `No ERC20 Transfer to pool ${poolAddress} for token ${poolTokenAddress} with amount >= ${tx.f_amount} (${expectedAmountWei} raw). Check tx hash and that you sent to the calldata toAddress.`,
      });
    }

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
        tokenAddress: poolTokenAddress,
        symbol: tx.f_token,
        amount,
        address: poolAddress.toLowerCase(),
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
