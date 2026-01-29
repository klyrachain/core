import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { setBalance, getBalance, type BalanceEntry } from "../lib/redis.js";

export type InventoryDeductionInput = {
  chain: string;
  tokenAddress: string;
  symbol: string;
  amount: Decimal | string | number;
  type?: "PURCHASE" | "SALE" | "REBALANCE";
  initialPurchasePrice?: Decimal | string | number;
  providerQuotePrice?: Decimal | string | number;
};

/**
 * Tracks internal inventory. On BUY we deduct from InventoryAsset balance.
 * Uses DB for source of truth and optionally updates Redis cache.
 */
export async function deductInventory(input: InventoryDeductionInput): Promise<void> {
  const amount = typeof input.amount === "object" ? new Decimal(input.amount) : new Decimal(input.amount);
  const type = input.type ?? "SALE";

  const asset = await prisma.inventoryAsset.findUnique({
    where: {
      chain_tokenAddress: { chain: input.chain, tokenAddress: input.tokenAddress },
    },
  });

  if (!asset) {
    throw new Error(`InventoryAsset not found: ${input.chain}/${input.tokenAddress}`);
  }

  const current = new Decimal(asset.currentBalance);
  if (current.lt(amount)) {
    throw new Error(
      `Insufficient inventory: ${asset.symbol} has ${current.toString()}, required ${amount.toString()}`
    );
  }

  const newBalance = current.minus(amount);
  const quantity = amount;

  await prisma.$transaction([
    prisma.inventoryAsset.update({
      where: { id: asset.id },
      data: { currentBalance: newBalance },
    }),
    prisma.inventoryHistory.create({
      data: {
        assetId: asset.id,
        type,
        amount,
        quantity,
        initialPurchasePrice: input.initialPurchasePrice ?? 0,
        providerQuotePrice: input.providerQuotePrice ?? 0,
      },
    }),
  ]);

  const entry: BalanceEntry = {
    amount: newBalance.toString(),
    status: "updated",
    updatedAt: new Date().toISOString(),
  };
  await setBalance(input.chain, input.symbol, entry);
}

/**
 * Get cached balance from Redis or null if not cached.
 */
export async function getCachedBalance(chain: string, token: string): Promise<BalanceEntry | null> {
  return getBalance(chain, token);
}

/**
 * Sync Redis balance from DB for a given chain/token (stub for TTL refresh).
 */
export async function refreshBalanceCache(chain: string, tokenAddress: string): Promise<void> {
  const asset = await prisma.inventoryAsset.findUnique({
    where: { chain_tokenAddress: { chain, tokenAddress } },
  });
  if (!asset) return;
  const entry: BalanceEntry = {
    amount: asset.currentBalance.toString(),
    status: "synced",
    updatedAt: new Date().toISOString(),
  };
  await setBalance(chain, asset.symbol, entry);
}
