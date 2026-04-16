/**
 * App /flows transfer: create a SELL (deposit to liquidity pool) with quoted destination,
 * then return the same calldata shape as GET /api/offramp/calldata for wallet execution.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../../lib/prisma.js";
import { successEnvelope } from "../../lib/api-helpers.js";
import { requirePermission } from "../../lib/admin-auth.guard.js";
import { PERMISSION_CONNECT_TRANSACTIONS } from "../../lib/permissions.js";
import { buildOfframpCalldataForTransaction } from "../../services/offramp-calldata.service.js";

const SLUG_TO_CHAIN: Record<string, string> = {
  ethereum: "ETHEREUM",
  eth: "ETHEREUM",
  mainnet: "ETHEREUM",
  base: "BASE",
  optimism: "OPTIMISM",
  op: "OPTIMISM",
  arbitrum: "ARBITRUM",
  arb: "ARBITRUM",
  polygon: "POLYGON",
  matic: "POLYGON",
};

const IntentBodySchema = z.object({
  f_chain_slug: z.string().min(1),
  f_token: z.string().min(1),
  f_amount: z.string().min(1),
  t_chain_slug: z.string().min(1),
  t_token: z.string().min(1),
  t_amount: z.string().min(1),
  receiver_address: z.string().min(1),
});

function slugToCoreChain(slug: string): string | null {
  const k = slug.trim().toLowerCase();
  return SLUG_TO_CHAIN[k] ?? null;
}

export async function appTransferApiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/app-transfer/intent", async (req: FastifyRequest<{ Body: unknown }>, reply) => {
    if (!requirePermission(req, reply, PERMISSION_CONNECT_TRANSACTIONS, { allowMerchant: true })) return;
    const parse = IntentBodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parse.error.flatten(),
      });
    }
    const b = parse.data;
    const f_chain = slugToCoreChain(b.f_chain_slug);
    const t_chain = slugToCoreChain(b.t_chain_slug);
    if (!f_chain || !t_chain) {
      return reply.status(400).send({
        success: false,
        error: "Unsupported chain slug. Use ethereum, base, optimism, arbitrum, polygon.",
      });
    }

    let fAmount: Decimal;
    let tAmount: Decimal;
    try {
      fAmount = new Decimal(b.f_amount);
      tAmount = new Decimal(b.t_amount);
    } catch {
      return reply.status(400).send({ success: false, error: "Invalid amount format" });
    }
    if (fAmount.lte(0) || tAmount.lte(0)) {
      return reply.status(400).send({ success: false, error: "Amounts must be positive" });
    }

    const exchangeRate =
      fAmount.gt(0) && tAmount.gt(0) ? tAmount.div(fAmount).toNumber() : 1;

    const recv = b.receiver_address.trim();
    if (!recv.startsWith("0x") || recv.length !== 42) {
      return reply.status(400).send({
        success: false,
        error: "receiver_address must be a valid 0x EVM address for this flow.",
      });
    }

    const tx = await prisma.transaction.create({
      data: {
        type: "SELL",
        status: "PENDING",
        f_amount: fAmount,
        t_amount: tAmount,
        exchangeRate: exchangeRate,
        f_chain,
        t_chain,
        f_token: b.f_token.trim().toUpperCase(),
        t_token: b.t_token.trim().toUpperCase(),
        f_tokenPriceUsd: 1,
        t_tokenPriceUsd: 1,
        f_provider: "KLYRA",
        t_provider: "NONE",
        toIdentifier: recv,
        toType: "ADDRESS",
      },
    });

    const built = await buildOfframpCalldataForTransaction(tx.id);
    if (!built.ok) {
      await prisma.transaction.delete({ where: { id: tx.id } }).catch(() => {});
      return reply.status(built.status).send({ success: false, error: built.error });
    }

    return successEnvelope(reply, {
      transaction_id: tx.id,
      calldata: built.data,
      next_step: "Sign and send ERC20 transfer to pool, then POST /api/offramp/confirm with tx_hash",
    });
  });
}
