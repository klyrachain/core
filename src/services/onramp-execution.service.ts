/**
 * Execute onramp: after Paystack charge.success, send crypto from liquidity pool to user.
 * Records balance before/after for audit; deducts inventory on success.
 *
 * Testnet (ONRAMP_TESTNET_SEND + TESTNET_SEND_PRIVATE_KEY, t_chain BASE or BASE SEPOLIA):
 * - USDC: sends Base Sepolia USDC. No mainnet funds at risk; no inventory deduction.
 * - ETH: sends native Base Sepolia ETH. If TESTNET_ETH_USD_RATE is set, t_amount is treated as USD and converted to ETH.
 * Mainnet: prefer sending the requested token if available; otherwise swap then send (swap quote: use POST /api/quote/swap or /api/quote/swap/all).
 */

import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { getEnv } from "../config/env.js";
import { getLiquidityPoolWallet } from "./liquidity-pool.service.js";
import { findPoolTokenFromDb } from "./supported-token.service.js";
import { deductInventory } from "./inventory.service.js";
import { sendFromLiquidityPool, sendTestnetBaseSepoliaUsdc, sendTestnetBaseSepoliaEth } from "./crypto-send.service.js";
import { triggerTransactionStatusChange } from "./pusher.service.js";

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
 * Send crypto to user after onramp payment (BUY). Idempotent: if cryptoSendTxHash already set,
 * returns success with that hash. Runs when payment is confirmed (paymentConfirmedAt set) or legacy COMPLETED.
 * Sets COMPLETED only after crypto is sent. Records balance before/after; deducts inventory (mainnet only).
 */
export async function executeOnrampSend(transactionId: string): Promise<ExecuteOnrampSendResult> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      type: true,
      status: true,
      paymentConfirmedAt: true,
      toIdentifier: true,
      t_chain: true,
      t_token: true,
      t_amount: true,
      t_tokenPriceUsd: true,
      cryptoSendTxHash: true,
    },
  });
  if (!tx) return { ok: false, error: "Transaction not found", code: "TX_NOT_FOUND" };
  if (tx.type !== "BUY") return { ok: false, error: "Transaction is not a BUY", code: "INVALID_TYPE" };
  if (tx.cryptoSendTxHash) return { ok: true, txHash: tx.cryptoSendTxHash };
  const paymentReady = tx.status === "COMPLETED" || (tx.status === "PENDING" && tx.paymentConfirmedAt != null);
  if (!paymentReady) {
    console.warn(`[onramp] Step 2 skipped: payment not confirmed yet for ${transactionId} (status=${tx.status}, paymentConfirmedAt=${tx.paymentConfirmedAt ?? "null"}).`);
    return { ok: false, error: "Payment not confirmed yet", code: "INVALID_STATUS" };
  }

  // toIdentifier must be set when the order is created (e.g. webhook/order or test/onramp/order) so we know where to send crypto.
  const toAddress = (tx.toIdentifier ?? "").trim();
  if (!toAddress || !toAddress.startsWith("0x")) {
    console.warn(`[onramp] Step 2 FAILED: missing or invalid toIdentifier (wallet) for ${transactionId}.`);
    return { ok: false, error: "Missing or invalid toIdentifier (wallet address)", code: "INVALID_TO" };
  }

  const env = getEnv();
  const testnetSendEnabled = (v: string | undefined) =>
    typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "0" && v.trim().toLowerCase() !== "false";
  const tChainUpper = tx.t_chain?.toUpperCase() ?? "";
  const tTokenUpper = tx.t_token?.toUpperCase() ?? "";
  // Only BASE SEPOLIA (testnet) uses testnet send. BASE (mainnet 8453) must always use mainnet path.
  const isTestnetChain = tChainUpper === "BASE SEPOLIA";
  const isTestnetToken = tTokenUpper === "USDC" || tTokenUpper === "ETH";
  const useTestnetSend =
    testnetSendEnabled(env.ONRAMP_TESTNET_SEND) &&
    !!env.TESTNET_SEND_PRIVATE_KEY?.trim() &&
    isTestnetChain &&
    isTestnetToken;

  let amountStr = tx.t_amount.toString();
  if (useTestnetSend && tTokenUpper === "ETH" && env.TESTNET_ETH_USD_RATE != null && Number(env.TESTNET_ETH_USD_RATE) > 0) {
    const usdValue = Number(tx.t_amount);
    if (Number.isFinite(usdValue) && usdValue > 0) {
      const ethAmount = usdValue / Number(env.TESTNET_ETH_USD_RATE);
      amountStr = String(ethAmount);
    }
  }

  console.log(
    `[onramp] Step 2: Payment confirmed. Sending crypto for transaction ${transactionId}: ${amountStr} ${tx.t_token} on ${tx.t_chain} → ${toAddress}${useTestnetSend ? ` (testnet: Base Sepolia ${tTokenUpper})` : ""}.`
  );

  if (useTestnetSend) {
    const sendResult =
      tTokenUpper === "ETH"
        ? await sendTestnetBaseSepoliaEth(toAddress, amountStr, transactionId)
        : await sendTestnetBaseSepoliaUsdc(toAddress, amountStr, transactionId);
    if (!sendResult.ok) {
      console.warn(`[onramp] Step 2 FAILED: testnet send error for ${transactionId}: ${sendResult.error}. Transaction remains PENDING.`);
      return { ok: false, error: sendResult.error, code: "SEND_FAILED" };
    }
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "COMPLETED", cryptoSendTxHash: sendResult.txHash },
    });
    await triggerTransactionStatusChange({
      transactionId,
      status: "COMPLETED",
      type: "BUY",
    }).catch(() => {});
    console.log(`[onramp] Step 3: Crypto SENT successfully. Transaction ${transactionId} COMPLETED. txHash=${sendResult.txHash}`);
    return { ok: true, txHash: sendResult.txHash };
  }

  const poolWallet = await getLiquidityPoolWallet(tx.t_chain);
  if (!poolWallet) {
    console.warn(`[onramp] Step 2 FAILED: no liquidity pool wallet for chain ${tx.t_chain} (tx ${transactionId}).`);
    return { ok: false, error: "No crypto liquidity pool wallet for this chain", code: "NO_LIQUIDITY_POOL" };
  }

  const chainId = CHAIN_NAME_TO_ID[tx.t_chain?.toUpperCase() ?? ""] ?? 8453;
  const poolToken = await findPoolTokenFromDb(chainId, tx.t_token);
  if (!poolToken) {
    console.warn(`[onramp] Step 2 FAILED: unsupported token ${tx.t_token} on ${tx.t_chain} (tx ${transactionId}).`);
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
    console.warn(`[onramp] Step 2 FAILED: no inventory asset for pool/token (tx ${transactionId}).`);
    return { ok: false, error: "No inventory asset for liquidity pool and token", code: "NO_ASSET" };
  }

  const amount = new Decimal(tx.t_amount);
  const current = new Decimal(asset.currentBalance);
  if (current.lt(amount)) {
    console.warn(`[onramp] Step 2 FAILED: insufficient balance for ${transactionId}. ${asset.symbol} has ${current.toString()}, need ${amount.toString()}.`);
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
  if (!wallet) {
    console.warn(`[onramp] Step 2 FAILED: wallet not found for pool (tx ${transactionId}).`);
    return { ok: false, error: "Wallet not found", code: "WALLET_NOT_FOUND" };
  }

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
    console.warn(`[onramp] Step 2 FAILED: mainnet send error for ${transactionId}: ${sendResult.error}. Transaction remains PENDING.`);
    return { ok: false, error: sendResult.error, code: "SEND_FAILED" };
  }

  const tTokenPriceUsd = tx.t_tokenPriceUsd != null ? Number(tx.t_tokenPriceUsd) : 0;
  await deductInventory({
    chain: tx.t_chain,
    chainId,
    tokenAddress: poolToken.address,
    symbol: asset.symbol,
    amount: tx.t_amount,
    address: poolWallet.address.toLowerCase(),
    type: "PURCHASE",
    pricePerTokenUsd: tTokenPriceUsd > 0 ? tTokenPriceUsd : 0,
    sourceTransactionId: transactionId,
  });

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: "COMPLETED", cryptoSendTxHash: sendResult.txHash },
  });
  await triggerTransactionStatusChange({
    transactionId,
    status: "COMPLETED",
    type: "BUY",
  }).catch(() => {});
  console.log(`[onramp] Step 3: Crypto SENT successfully. Transaction ${transactionId} COMPLETED. txHash=${sendResult.txHash}`);

  return { ok: true, txHash: sendResult.txHash };
}

/**
 * Send crypto to address for a REQUEST transaction (settlement to requester). Same logic as executeOnrampSend but for REQUEST and toAddress from param.
 */
export async function executeRequestSettlementSend(
  transactionId: string,
  toAddress: string
): Promise<ExecuteOnrampSendResult> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      type: true,
      status: true,
      t_chain: true,
      t_token: true,
      t_amount: true,
      t_tokenPriceUsd: true,
      cryptoSendTxHash: true,
    },
  });
  if (!tx) return { ok: false, error: "Transaction not found", code: "TX_NOT_FOUND" };
  if (tx.type !== "REQUEST") return { ok: false, error: "Transaction is not a REQUEST", code: "INVALID_TYPE" };
  if (tx.cryptoSendTxHash) return { ok: true, txHash: tx.cryptoSendTxHash };

  const address = toAddress.trim();
  if (!address || !address.startsWith("0x")) {
    return { ok: false, error: "Invalid payout address (must be 0x...)", code: "INVALID_TO" };
  }

  const env = getEnv();
  const testnetSendEnabled = (v: string | undefined) =>
    typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "0" && v.trim().toLowerCase() !== "false";
  const tChainUpper = tx.t_chain?.toUpperCase() ?? "";
  const tTokenUpper = tx.t_token?.toUpperCase() ?? "";
  // Only BASE SEPOLIA uses testnet send. Mainnet (BASE) must never use testnet path.
  const isTestnetChain = tChainUpper === "BASE SEPOLIA";
  const isTestnetToken = tTokenUpper === "USDC" || tTokenUpper === "ETH";
  const useTestnetSend =
    testnetSendEnabled(env.ONRAMP_TESTNET_SEND) &&
    !!env.TESTNET_SEND_PRIVATE_KEY?.trim() &&
    isTestnetChain &&
    isTestnetToken;

  let amountStr = tx.t_amount.toString();
  if (useTestnetSend && tTokenUpper === "ETH" && env.TESTNET_ETH_USD_RATE != null && Number(env.TESTNET_ETH_USD_RATE) > 0) {
    const usdValue = Number(tx.t_amount);
    if (Number.isFinite(usdValue) && usdValue > 0) {
      amountStr = String(usdValue / Number(env.TESTNET_ETH_USD_RATE));
    }
  }

  if (useTestnetSend) {
    const sendResult =
      tTokenUpper === "ETH"
        ? await sendTestnetBaseSepoliaEth(address, amountStr, transactionId)
        : await sendTestnetBaseSepoliaUsdc(address, amountStr, transactionId);
    if (!sendResult.ok) return sendResult;
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "COMPLETED", cryptoSendTxHash: sendResult.txHash },
    });
    await triggerTransactionStatusChange({ transactionId, status: "COMPLETED", type: "REQUEST" }).catch(() => {});
    return { ok: true, txHash: sendResult.txHash };
  }

  const poolWallet = await getLiquidityPoolWallet(tx.t_chain);
  if (!poolWallet) return { ok: false, error: "No liquidity pool for " + tx.t_chain, code: "NO_LIQUIDITY_POOL" };
  const chainId = CHAIN_NAME_TO_ID[tChainUpper] ?? 8453;
  const poolToken = await findPoolTokenFromDb(chainId, tx.t_token);
  if (!poolToken) return { ok: false, error: `Unsupported token ${tx.t_token}`, code: "UNSUPPORTED_TOKEN" };
  const asset = await prisma.inventoryAsset.findFirst({
    where: {
      chainId,
      tokenAddress: poolToken.address.toLowerCase(),
      address: poolWallet.address.toLowerCase(),
    },
    select: { id: true, currentBalance: true, symbol: true },
  });
  if (!asset) return { ok: false, error: "No inventory asset", code: "NO_ASSET" };
  const amount = new Decimal(tx.t_amount);
  if (new Decimal(asset.currentBalance).lt(amount)) {
    return { ok: false, error: "Insufficient balance", code: "INSUFFICIENT_BALANCE" };
  }
  const wallet = await prisma.wallet.findUnique({ where: { id: poolWallet.id }, select: { id: true } });
  if (!wallet) return { ok: false, error: "Wallet not found", code: "WALLET_NOT_FOUND" };
  const sendResult = await sendFromLiquidityPool({
    walletId: wallet.id,
    toAddress: address,
    chain: tx.t_chain,
    tokenSymbol: tx.t_token,
    tokenAddress: poolToken.address,
    amountHuman: tx.t_amount.toString(),
    decimals: poolToken.decimals ?? 18,
    transactionId,
  });
  if (!sendResult.ok) return sendResult;
  const tTokenPriceUsd = tx.t_tokenPriceUsd != null ? Number(tx.t_tokenPriceUsd) : 0;
  await deductInventory({
    chain: tx.t_chain,
    chainId,
    tokenAddress: poolToken.address,
    symbol: asset.symbol,
    amount: tx.t_amount,
    address: poolWallet.address.toLowerCase(),
    type: "PURCHASE",
    pricePerTokenUsd: tTokenPriceUsd > 0 ? tTokenPriceUsd : 0,
    sourceTransactionId: transactionId,
  });
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: "COMPLETED", cryptoSendTxHash: sendResult.txHash },
  });
  await triggerTransactionStatusChange({ transactionId, status: "COMPLETED", type: "REQUEST" }).catch(() => {});
  return { ok: true, txHash: sendResult.txHash };
}
