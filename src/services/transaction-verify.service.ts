/**
 * Verify on-chain transactions by hash: fetch tx + receipt and parse ERC20 Transfer events.
 * Used to confirm offramp (user sent token to our pool) and to verify onramp send (crypto received by user).
 * No external APIs — uses public RPC only (viem).
 */

import { createPublicClient, http, parseEventLogs, type Hash } from "viem";
import { getEnv } from "../config/env.js";

const ERC20_TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export type TransferItem = {
  token: string; // token contract address
  from: string;
  to: string;
  valueRaw: string; // wei/smallest unit
  valueHuman?: string; // optional if decimals provided
};

export type VerifyByHashResult =
  | {
      ok: true;
      chainId: number;
      hash: string;
      blockNumber: bigint;
      /** Block timestamp (Unix seconds). Used to reject tx mined before order creation (replay protection). */
      blockTimestamp: number;
      status: "success" | "reverted";
      from: string;
      to: string;
      transfers: TransferItem[];
      receipt: { gasUsed: string; effectiveGasPrice?: string };
    }
  | { ok: false; error: string };

// Static RPC lists: first URL is primary, rest are fallbacks (tried in order).
const RPC_FALLBACKS: Record<number, string[]> = {
  1: ["https://eth.llamarpc.com", "https://1rpc.io/eth", "https://ethereum.publicnode.com"],
  8453: [
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://base.meowrpc.com",
  ],
  84532: [
    "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.drpc.org",
    "https://base-sepolia.gateway.tenderly.co",
  ],
  56: ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io"],
  137: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"],
  42161: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
};

function getRpcUrls(chainId: number): string[] {
  const env = getEnv();
  const override =
    chainId === 84532 ? env.BASE_SEPOLIA_RPC_URL?.trim() : chainId === 8453 ? env.BASE_RPC_URL?.trim() : undefined;
  const fallbacks = RPC_FALLBACKS[chainId] ?? [`https://${chainId}.chain.llamarpc.com`];
  if (override) return [override, ...fallbacks.filter((u) => u !== override)];
  return fallbacks;
}

/**
 * Fetch transaction and receipt for the given chain + hash; parse ERC20 Transfer logs.
 * Tries RPC URLs in order (env override first, then fallbacks). Use correct chain: BASE = mainnet 8453, BASE SEPOLIA = testnet 84532.
 */
export async function verifyTransactionByHash(
  chainId: number,
  txHash: string
): Promise<VerifyByHashResult> {
  const hash = txHash.startsWith("0x") ? (txHash as Hash) : (`0x${txHash}` as Hash);
  const rpcUrls = getRpcUrls(chainId);
  let lastError: string | undefined;

  for (const rpcUrl of rpcUrls) {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    try {
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);

      if (!tx) {
        lastError = "Transaction not found";
        continue;
      }
      if (!receipt) {
        lastError = "Transaction receipt not found (may not be mined yet)";
        continue;
      }

      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const blockTimestamp = block?.timestamp != null ? Number(block.timestamp) : 0;

      const status = receipt.status === "success" ? "success" : "reverted";
      const transfers: TransferItem[] = [];

      if (receipt.logs.length > 0) {
        const parsed = parseEventLogs({
          abi: ERC20_TRANSFER_ABI,
          logs: receipt.logs,
        });
        for (const log of parsed) {
          if (log.eventName === "Transfer") {
            transfers.push({
              token: log.address.toLowerCase(),
              from: (log.args as { from?: string }).from ?? "",
              to: (log.args as { to?: string }).to ?? "",
              valueRaw: String((log.args as { value?: bigint }).value ?? 0n),
            });
          }
        }
      }

      return {
        ok: true,
        chainId,
        hash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockTimestamp,
        status,
        from: tx.from,
        to: tx.to ?? "",
        transfers,
        receipt: {
          gasUsed: String(receipt.gasUsed),
          effectiveGasPrice: receipt.effectiveGasPrice != null ? String(receipt.effectiveGasPrice) : undefined,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      if (msg.includes("could not be found") || msg.includes("not found")) continue;
      if (msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("fetch")) continue;
    }
  }

  return {
    ok: false,
    error: lastError
      ? `RPC or decode failed: ${lastError}. Chain ${chainId} (BASE=8453, BASE SEPOLIA=84532). Ensure the tx is on this chain.`
      : "All RPCs failed for this chain.",
  };
}

/**
 * Check that a transaction sent at least `expectedAmountWei` of `tokenAddress` to `toAddress`.
 * Used by offramp confirm to ensure user actually sent funds to our pool.
 */
export function transferMatches(
  transfers: TransferItem[],
  tokenAddress: string,
  toAddress: string,
  expectedAmountWei: bigint
): boolean {
  const tokenLower = tokenAddress.toLowerCase();
  const toLower = toAddress.toLowerCase();
  for (const t of transfers) {
    if (t.token === tokenLower && t.to === toLower && BigInt(t.valueRaw) >= expectedAmountWei) {
      return true;
    }
  }
  return false;
}
