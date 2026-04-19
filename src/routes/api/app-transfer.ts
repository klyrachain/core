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
import type { PaymentInstruction } from "../../services/payment-instruction.service.js";
import { ecosystemFromCoreChain } from "../../lib/payment-chain-routing.js";
import { isValidReceiverForEcosystem } from "../../lib/payment-address-validation.js";

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
  solana: "SOLANA",
  stellar: "STELLAR",
  bitcoin: "BITCOIN",
  btc: "BITCOIN",
  sui: "SUI",
  tron: "TRON",
  aptos: "APTOS",
};

/** Numeric Squid / wallet chain id → Core `f_chain` / `t_chain` codes (matches checkout mapping). */
const CHAIN_ID_TO_CORE: Record<string, string> = {
  "1": "ETHEREUM",
  "8453": "BASE",
  "56": "BNB",
  "137": "POLYGON",
  "42161": "ARBITRUM",
  "10": "OPTIMISM",
  "43114": "AVALANCHE",
  "250": "FANTOM",
  "100": "GNOSIS",
  "59144": "LINEA",
  "534352": "SCROLL",
  "81457": "BLAST",
  "5000": "MANTLE",
  "324": "ZKSYNC",
  "1101": "POLYGON_ZKEVM",
  "101": "SOLANA",
  "148": "STELLAR",
  "8332": "BITCOIN",
};

const IntentBodySchema = z.object({
  f_chain_slug: z.string().min(1),
  f_token: z.string().min(1),
  f_amount: z.string().min(1),
  t_chain_slug: z.string().min(1),
  t_token: z.string().min(1),
  t_amount: z.string().min(1),
  receiver_address: z.string().min(1),
  /** When set, links the SELL to a public commerce payment link (checkout / settlement). */
  payment_link_id: z.string().uuid().optional(),
});

function slugToCoreChain(slug: string): string | null {
  const trimmed = slug.trim();
  const k = trimmed.toLowerCase();
  if (SLUG_TO_CHAIN[k]) return SLUG_TO_CHAIN[k];
  return CHAIN_ID_TO_CORE[trimmed] ?? null;
}

function nextStepForInstruction(inst: PaymentInstruction): string {
  switch (inst.kind) {
    case "evm_erc20_transfer":
      return "Sign and send ERC20 transfer to pool, then POST /api/offramp/confirm with tx_hash";
    case "solana_spl_transfer":
      return "Send SPL transfer per calldata; automatic POST /api/offramp/confirm is not available for Solana yet.";
    case "stellar_payment":
      return "Submit Stellar payment per calldata; automatic confirm is not available for Stellar yet.";
    case "bitcoin_utxo":
      return "Send native BTC per calldata; automatic confirm is not available for Bitcoin yet.";
    case "unsupported":
      return "Unsupported instruction: adjust chain/token or add PlatformPoolDestination + Infisical config.";
    default:
      return "Complete payment using the returned calldata/instruction payload.";
  }
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
        error:
          "Unsupported chain slug. Use name slugs (e.g. base, ethereum) or a supported numeric chain id (e.g. 8453).",
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
    const recvEcosystem = ecosystemFromCoreChain(f_chain);
    if (!isValidReceiverForEcosystem(recvEcosystem, recv)) {
      return reply.status(400).send({
        success: false,
        error: `receiver_address is not valid for ecosystem ${recvEcosystem} (f_chain ${f_chain}).`,
      });
    }

    let paymentLinkId: string | undefined;
    if (b.payment_link_id?.trim()) {
      const link = await prisma.paymentLink.findFirst({
        where: { id: b.payment_link_id.trim(), isActive: true },
        select: { id: true },
      });
      if (!link) {
        return reply.status(404).send({
          success: false,
          error: "Payment link not found or inactive.",
          code: "PAYMENT_LINK_NOT_FOUND",
        });
      }
      paymentLinkId = link.id;
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
        paymentLinkId: paymentLinkId ?? undefined,
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
      next_step: nextStepForInstruction(built.data),
    });
  });
}
