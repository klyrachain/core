/**
 * Execute onramp: after Paystack charge.success, send crypto from liquidity pool to user.
 * Records balance before/after for audit; deducts inventory on success.
 */

import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { getLiquidityPoolWallet } from "./liquidity-pool.service.js";
import { findPoolTokenFromDb } from "./supported-token.service.js";
import { deductInventory } from "./inventory.service.js";
import { sendFromLiquidityPool } from "./crypto-send.service.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
};

export type ExecuteOnrampSendResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string; code?: string };

/**
 * Send crypto to user after onramp payment (BUY, COMPLETED). Idempotent: if cryptoSendTxHash
 * already set, returns success with that hash. Records balance before/after; deducts inventory.
 */
export async function executeOnrampSend(transactionId: string): Promise<ExecuteOnrampSendResult> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      type: true,
      status: true,
      toIdentifier: true,
      t_chain: true,
      t_token: true,
      t_amount: true,
      cryptoSendTxHash: true,
    },
  });
  if (!tx) return { ok: false, error: "Transaction not found", code: "TX_NOT_FOUND" };
  if (tx.type !== "BUY") return { ok: false, error: "Transaction is not a BUY", code: "INVALID_TYPE" };
  if (tx.status !== "COMPLETED") return { ok: false, error: "Transaction not COMPLETED", code: "INVALID_STATUS" };
  if (tx.cryptoSendTxHash) return { ok: true, txHash: tx.cryptoSendTxHash };

  const toAddress = (tx.toIdentifier ?? "").trim();
  if (!toAddress || !toAddress.startsWith("0x")) {
    return { ok: false, error: "Missing or invalid toIdentifier (wallet address)", code: "INVALID_TO" };
  }

  const poolWallet = await getLiquidityPoolWallet(tx.t_chain);
  if (!poolWallet) {
    return { ok: false, error: "No crypto liquidity pool wallet for this chain", code: "NO_LIQUIDITY_POOL" };
  }

  const chainId = CHAIN_NAME_TO_ID[tx.t_chain?.toUpperCase() ?? ""] ?? 8453;
  const poolToken = await findPoolTokenFromDb(chainId, tx.t_token);
  if (!poolToken) {
    return { ok: false, error: `Unsupported token ${tx.t_token} on chain ${tx.t_chain}`, code: "UNSUPPORTED_TOKEN" };
  }

  const asset = await prisma.inventoryAsset.findFirst({
    where: {
      chainId,
      tokenAddress: poolToken.address.toLowerCase(),
      address: poolWallet.address.toLowerCase(),
    },
    select: { id: true, currentBalance: true, symbol: true },
  });
  if (!asset) {
    return { ok: false, error: "No inventory asset for liquidity pool and token", code: "NO_ASSET" };
  }

  const amount = new Decimal(tx.t_amount);
  const current = new Decimal(asset.currentBalance);
  if (current.lt(amount)) {
    return {
      ok: false,
      error: `Insufficient balance: ${asset.symbol} has ${current.toString()}, need ${amount.toString()}`,
      code: "INSUFFICIENT_BALANCE",
    };
  }

  const wallet = await prisma.wallet.findUnique({
    where: { id: poolWallet.id },
    select: { id: true },
  });
  if (!wallet) return { ok: false, error: "Wallet not found", code: "WALLET_NOT_FOUND" };

  const sendResult = await sendFromLiquidityPool({
    walletId: wallet.id,
    toAddress,
    chain: tx.t_chain,
    tokenSymbol: tx.t_token,
    tokenAddress: poolToken.address,
    amountHuman: tx.t_amount.toString(),
    decimals: poolToken.decimals ?? 18,
    transactionId,
  });

  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error, code: "SEND_FAILED" };
  }

  await deductInventory({
    chain: tx.t_chain,
    chainId,
    tokenAddress: poolToken.address,
    symbol: asset.symbol,
    amount: tx.t_amount,
    address: poolWallet.address.toLowerCase(),
    type: "PURCHASE",
    providerQuotePrice: null,
    sourceTransactionId: transactionId,
  });

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { cryptoSendTxHash: sendResult.txHash },
  });

  return { ok: true, txHash: sendResult.txHash };
}
