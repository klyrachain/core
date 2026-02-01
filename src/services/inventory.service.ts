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

function toDecimal(v: Decimal | string | number | undefined): Decimal {
  if (v === undefined || v === null) return new Decimal(0);
  return typeof v === "object" ? new Decimal(v) : new Decimal(v);
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
  sourceTransactionId?: string;
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
  sourceTransactionId?: string;
};

export type AllocatedLot = {
  lotId: string;
  quantity: Decimal;
  costPerToken: Decimal;
};

export type DeductInventoryResult = {
  averageCostPerToken: Decimal | null; // volume-weighted cost of allocated lots; null if no lots used
  allocatedLots: AllocatedLot[]; // FIFO allocation for P&L (fee = selling - provider, profit = selling - cost)
};

/**
 * Deduct from inventory (we give token to user). Used when we deliver t_token on BUY or t_token on SELL.
 * Allocates from lots FIFO (oldest first); updates lot quantities and returns volume-weighted cost basis.
 * Uses DB for source of truth and updates Redis cache.
 */
export async function deductInventory(input: InventoryDeductionInput): Promise<DeductInventoryResult> {
  const amount = toDecimal(input.amount);
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
    include: {
      lots: {
        where: { quantity: { gt: 0 } },
        orderBy: { acquiredAt: "asc" },
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
  let totalCost = new Decimal(0);
  let allocated = new Decimal(0);
  const lotUpdates: { id: string; newQuantity: Decimal }[] = [];
  const allocatedLots: AllocatedLot[] = [];

  for (const lot of asset.lots) {
    if (allocated.gte(amount)) break;
    const lotQty = new Decimal(lot.quantity);
    if (lotQty.lte(0)) continue;
    const need = amount.minus(allocated);
    const take = Decimal.min(lotQty, need);
    if (take.gt(0)) {
      allocatedLots.push({
        lotId: lot.id,
        quantity: take,
        costPerToken: new Decimal(lot.costPerToken),
      });
    }
    const cost = take.mul(lot.costPerToken);
    totalCost = totalCost.plus(cost);
    allocated = allocated.plus(take);
    const newQty = lotQty.minus(take);
    lotUpdates.push({ id: lot.id, newQuantity: newQty });
  }

  const averageCostPerToken =
    allocated.gt(0) && totalCost.gte(0) ? totalCost.div(allocated) : null;
  const historyCost = averageCostPerToken ?? toDecimal(input.initialPurchasePrice ?? input.providerQuotePrice ?? 0);

  await prisma.$transaction(async (tx) => {
    for (const { id, newQuantity } of lotUpdates) {
      await tx.inventoryLot.update({
        where: { id },
        data: { quantity: newQuantity },
      });
    }
    await tx.inventoryAsset.update({
      where: { id: asset.id },
      data: { currentBalance: newBalance },
    });
    await tx.inventoryHistory.create({
      data: {
        assetId: asset.id,
        type,
        amount,
        quantity: amount,
        initialPurchasePrice: historyCost,
        providerQuotePrice: input.providerQuotePrice ?? 0,
      },
    });
  });

  const entry: BalanceEntry = {
    amount: newBalance.toString(),
    status: "updated",
    updatedAt: new Date().toISOString(),
  };
  await setBalance(input.chain, input.symbol, entry);

  return { averageCostPerToken, allocatedLots };
}

/**
 * Add to inventory (we receive token from user). Used when we receive f_token on BUY or f_token on SELL.
 * Creates a lot with cost basis (initialPurchasePrice or providerQuotePrice) for FIFO fulfillment.
 * Each token is in its own currency (e.g. USDC in USDC, ETH in ETH); no conversion between tokens here.
 */
export async function addInventory(input: InventoryAdditionInput): Promise<void> {
  const amount = toDecimal(input.amount);
  const type = input.type ?? "PURCHASE";
  const chainId = input.chainId ?? chainToChainId(input.chain);
  const costPerToken = toDecimal(input.initialPurchasePrice ?? input.providerQuotePrice ?? 0);

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
        quantity: amount,
        initialPurchasePrice: costPerToken,
        providerQuotePrice: input.providerQuotePrice ?? 0,
      },
    }),
    prisma.inventoryLot.create({
      data: {
        assetId: asset.id,
        quantity: amount,
        costPerToken,
        sourceType: type,
        sourceTransactionId: input.sourceTransactionId ?? undefined,
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
 * Sync all inventory assets to Redis (one balance per chain+symbol; multiple addresses summed).
 * Call before tests or when cache may be stale so Redis has current balances for validation.
 */
export async function syncAllInventoryBalancesToRedis(): Promise<{ synced: number }> {
  const assets = await prisma.inventoryAsset.findMany({
    select: { chain: true, symbol: true, currentBalance: true },
  });
  const byChainSymbol = new Map<string, { total: Decimal; chain: string; symbol: string }>();
  for (const a of assets) {
    const key = `${a.chain}:${a.symbol}`;
    const existing = byChainSymbol.get(key);
    const balance = toDecimal(a.currentBalance);
    if (existing) {
      existing.total = existing.total.plus(balance);
    } else {
      byChainSymbol.set(key, { total: balance, chain: a.chain, symbol: a.symbol });
    }
  }
  for (const { chain, symbol, total } of byChainSymbol.values()) {
    const entry: BalanceEntry = {
      amount: total.toString(),
      status: "synced",
      updatedAt: new Date().toISOString(),
    };
    await setBalance(chain, symbol, entry);
  }
  return { synced: byChainSymbol.size };
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

/**
 * Volume-weighted average cost basis of available lots for an asset.
 * Use as minSellingPrice (floor) in pricing engine quoteOnRamp so we never sell below cost.
 * Returns null if no lots or total quantity is zero.
 */
export async function getAverageCostBasis(assetId: string): Promise<Decimal | null> {
  const lots = await prisma.inventoryLot.findMany({
    where: { assetId, quantity: { gt: 0 } },
    orderBy: { acquiredAt: "asc" },
  });
  if (lots.length === 0) return null;
  let totalQty = new Decimal(0);
  let totalCost = new Decimal(0);
  for (const lot of lots) {
    const q = new Decimal(lot.quantity);
    totalQty = totalQty.plus(q);
    totalCost = totalCost.plus(q.mul(lot.costPerToken));
  }
  if (totalQty.lte(0)) return null;
  return totalCost.div(totalQty);
}

/**
 * Volume-weighted average cost basis across all InventoryAssets with the same chain+symbol.
 * Used for validation cache so cost basis reflects all inventory (not just the first asset).
 * Returns null if no lots or total quantity is zero.
 */
export async function getAggregateCostBasis(chain: string, symbol: string): Promise<Decimal | null> {
  const assets = await prisma.inventoryAsset.findMany({
    where: {
      chain: { equals: chain.trim(), mode: "insensitive" },
      symbol: { equals: symbol.trim(), mode: "insensitive" },
    },
    select: { id: true },
  });
  if (assets.length === 0) return null;
  const assetIds = assets.map((a) => a.id);
  const lots = await prisma.inventoryLot.findMany({
    where: { assetId: { in: assetIds }, quantity: { gt: 0 } },
  });
  if (lots.length === 0) return null;
  let totalQty = new Decimal(0);
  let totalCost = new Decimal(0);
  for (const lot of lots) {
    const q = new Decimal(lot.quantity);
    totalQty = totalQty.plus(q);
    totalCost = totalCost.plus(q.mul(lot.costPerToken));
  }
  if (totalQty.lte(0)) return null;
  return totalCost.div(totalQty);
}

/**
 * Lots for an asset (FIFO order). Used for order-book style fulfillment and reporting.
 */
export async function getLotsForAsset(
  assetId: string,
  options?: { onlyAvailable?: boolean }
) {
  return prisma.inventoryLot.findMany({
    where: {
      assetId,
      ...(options?.onlyAvailable === true ? { quantity: { gt: 0 } } : {}),
    },
    orderBy: { acquiredAt: "asc" },
  });
}
