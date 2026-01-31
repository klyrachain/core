import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { setBalance, getBalance, type BalanceEntry } from "../lib/redis.js";

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
};

function chainToChainId(chain: string): number {
  const id = CHAIN_NAME_TO_ID[chain.toUpperCase()];
  return id ?? 1;
}

export type InventoryDeductionInput = {
  chain: string;
  chainId?: number;
  tokenAddress: string;
  symbol: string;
  amount: Decimal | string | number;
  address: string;
  type?: "PURCHASE" | "SALE" | "REBALANCE";
  initialPurchasePrice?: Decimal | string | number;
  providerQuotePrice?: Decimal | string | number;
};

export type InventoryAdditionInput = {
  chain: string;
  chainId?: number;
  tokenAddress: string;
  symbol: string;
  amount: Decimal | string | number;
  address: string;
  type?: "PURCHASE" | "SALE" | "REBALANCE";
  initialPurchasePrice?: Decimal | string | number;
  providerQuotePrice?: Decimal | string | number;
};

/**
 * Deduct from inventory (we give token to user). Used when we deliver t_token on BUY or t_token on SELL.
 * Uses DB for source of truth and updates Redis cache.
 */
export async function deductInventory(input: InventoryDeductionInput): Promise<void> {
  const amount = typeof input.amount === "object" ? new Decimal(input.amount) : new Decimal(input.amount);
  const type = input.type ?? "SALE";
  const chainId = input.chainId ?? chainToChainId(input.chain);

  const asset = await prisma.inventoryAsset.findUnique({
    where: {
      chainId_tokenAddress_address: {
        chainId,
        tokenAddress: input.tokenAddress,
        address: input.address,
      },
    },
  });

  if (!asset) {
    throw new Error(`InventoryAsset not found: ${input.chain}/${input.tokenAddress}/${input.address}`);
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
 * Add to inventory (we receive token from user). Used when we receive f_token on BUY or f_token on SELL.
 * Each token is in its own currency (e.g. USDC in USDC, ETH in ETH); no conversion between tokens here.
 */
export async function addInventory(input: InventoryAdditionInput): Promise<void> {
  const amount = typeof input.amount === "object" ? new Decimal(input.amount) : new Decimal(input.amount);
  const type = input.type ?? "PURCHASE";
  const chainId = input.chainId ?? chainToChainId(input.chain);

  const asset = await prisma.inventoryAsset.findUnique({
    where: {
      chainId_tokenAddress_address: {
        chainId,
        tokenAddress: input.tokenAddress,
        address: input.address,
      },
    },
  });

  if (!asset) {
    throw new Error(`InventoryAsset not found: ${input.chain}/${input.tokenAddress}/${input.address}`);
  }

  const current = new Decimal(asset.currentBalance);
  const newBalance = current.plus(amount);
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
 * Sync Redis balance from DB for a given chain/token/address (stub for TTL refresh).
 * When address is omitted, syncs the first matching asset (backward compat).
 */
export async function refreshBalanceCache(
  chain: string,
  tokenAddress: string,
  address?: string
): Promise<void> {
  const chainId = chainToChainId(chain);
  const asset = address
    ? await prisma.inventoryAsset.findUnique({
        where: { chainId_tokenAddress_address: { chainId, tokenAddress, address } },
      })
    : await prisma.inventoryAsset.findFirst({
        where: { chainId, tokenAddress },
      });
  if (!asset) return;
  const entry: BalanceEntry = {
    amount: asset.currentBalance.toString(),
    status: "synced",
    updatedAt: new Date().toISOString(),
  };
  await setBalance(chain, asset.symbol, entry);
}
