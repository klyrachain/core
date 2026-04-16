/**
 * Shared: liquidity pool destination for a SELL / offramp-style transaction.
 */

import { prisma } from "../lib/prisma.js";
import { getLiquidityPoolWallet } from "./liquidity-pool.service.js";
import { findPoolTokenFromDb } from "./supported-token.service.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  "BASE SEPOLIA": 84532,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
};

export type OfframpCalldataPayload = {
  toAddress: string;
  chainId: number;
  chain: string;
  token: string;
  tokenAddress: string;
  amount: string;
  decimals: number;
  message: string;
};

export async function buildOfframpCalldataForTransaction(
  transactionId: string
): Promise<
  | { ok: true; data: OfframpCalldataPayload }
  | { ok: false; status: number; error: string }
> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, type: true, status: true, f_chain: true, f_token: true, f_amount: true },
  });
  if (!tx) return { ok: false, status: 404, error: "Transaction not found" };
  if (tx.type !== "SELL") return { ok: false, status: 400, error: "Transaction must be SELL" };
  if (tx.status === "COMPLETED") {
    return { ok: false, status: 400, error: "Transaction already completed" };
  }

  const pool = await getLiquidityPoolWallet(tx.f_chain);
  if (!pool) {
    return {
      ok: false,
      status: 503,
      error: `No liquidity pool wallet for chain "${tx.f_chain}".`,
    };
  }

  const chainKey = tx.f_chain?.toUpperCase().replace(/-/g, " ") ?? "";
  const chainId =
    CHAIN_NAME_TO_ID[chainKey] ?? CHAIN_NAME_TO_ID[tx.f_chain?.toUpperCase() ?? ""] ?? 8453;
  const poolToken = await findPoolTokenFromDb(chainId, tx.f_token);
  if (!poolToken) return { ok: false, status: 400, error: `Unsupported token ${tx.f_token}` };

  return {
    ok: true,
    data: {
      toAddress: pool.address,
      chainId,
      chain: tx.f_chain,
      token: tx.f_token,
      tokenAddress: poolToken.address,
      amount: tx.f_amount.toString(),
      decimals: poolToken.decimals ?? 18,
      message:
        "Send this amount of token to toAddress, then POST /api/offramp/confirm with tx_hash.",
    },
  };
}
