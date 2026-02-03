/**
 * Send crypto from liquidity pool wallet to a recipient. Used for onramp (after Paystack success)
 * and for request/claim settlement. Decrypts wallet key and builds/sends tx.
 * Without RPC/viem configured, returns a stub result so the flow completes; add RPC and implement
 * with viem for production.
 */

import { WalletManager } from "../utils/wallet-manager.js";
import { prisma } from "../lib/prisma.js";

export type SendFromLiquidityPoolInput = {
  walletId: string;
  toAddress: string;
  chain: string;
  tokenSymbol: string;
  tokenAddress: string;
  amountHuman: string | number;
  decimals: number;
  transactionId: string;
};

export type SendFromLiquidityPoolResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

/**
 * Send token (or native) from the given wallet to toAddress.
 * Currently stubbed: decrypts key but does not broadcast (no RPC in core). Returns mock tx hash
 * so onramp flow can complete. Integrate with viem + RPC (e.g. process.env[`RPC_URL_${chainId}`])
 * to perform real sends.
 */
export async function sendFromLiquidityPool(
  input: SendFromLiquidityPoolInput
): Promise<SendFromLiquidityPoolResult> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: input.walletId },
    select: { encryptedKey: true, address: true },
  });
  if (!wallet?.encryptedKey) {
    return { ok: false, error: "Liquidity pool wallet or key not found" };
  }
  try {
    WalletManager.decrypt(wallet.encryptedKey);
  } catch {
    return { ok: false, error: "Failed to decrypt wallet key" };
  }
  // TODO: use viem to build and send tx (native or ERC20) when RPC is configured.
  // const chainId = CHAIN_NAME_TO_ID[input.chain.toUpperCase()] ?? 1;
  // const rpc = process.env[`RPC_URL_${chainId}`] ?? process.env.RPC_URL;
  // if (!rpc) return { ok: false, error: "RPC not configured" };
  // ... create walletClient, sendTransaction ...
  const mockTxHash = `0x${Buffer.from(`${input.transactionId}-${Date.now()}`).toString("hex").slice(0, 64)}`;
  return { ok: true, txHash: mockTxHash };
}
