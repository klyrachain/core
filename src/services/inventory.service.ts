import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { setBalance, getBalance, BALANCE_SYNC_TTL_SECONDS, type BalanceEntry } from "../lib/redis.js";
import { recordBalanceSnapshot } from "./transaction-balance-snapshot.service.js";

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
  /** USD price per token at time of disposal (for ledger). */
  pricePerTokenUsd: Decimal | string | number;
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
  /** USD price per token at acquisition (cost basis). Required for correct valuation. */
  costPerTokenUsd: Decimal | string | number;
  sourceTransactionId?: string;
};

export type AllocatedLot = {
  lotId: string;
  quantity: Decimal;
  costPerTokenUsd: Decimal;
};

export type DeductInventoryResult = {
  averageCostPerTokenUsd: Decimal | null; // volume-weighted USD cost of allocated lots; null if no lots used
  allocatedLots: AllocatedLot[]; // FIFO allocation for P&L
};

/**
 * Deduct from inventory (we give token to user). Used when we deliver t_token on BUY or t_token on SELL.
 * Allocates from lots FIFO (oldest OPEN first); updates remainingQuantity and status; writes DISPOSED ledger.
 * Uses DB for source of truth and updates Redis cache.
 */
export async function deductInventory(input: InventoryDeductionInput): Promise<DeductInventoryResult> {
  const amount = toDecimal(input.amount);
  const chainId = input.chainId ?? chainToChainId(input.chain);
  const pricePerTokenUsd = toDecimal(input.pricePerTokenUsd);

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
        where: { status: "OPEN", remainingQuantity: { gt: 0 } },
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
  let totalCostUsd = new Decimal(0);
  let allocated = new Decimal(0);
  const lotUpdates: { id: string; newRemaining: Decimal }[] = [];
  const allocatedLots: AllocatedLot[] = [];

  for (const lot of asset.lots) {
    if (allocated.gte(amount)) break;
    const lotQty = new Decimal(lot.remainingQuantity);
    if (lotQty.lte(0)) continue;
    const need = amount.minus(allocated);
    const take = Decimal.min(lotQty, need);
    if (take.gt(0)) {
      allocatedLots.push({
        lotId: lot.id,
        quantity: take,
        costPerTokenUsd: new Decimal(lot.costPerTokenUsd),
      });
    }
    const costUsd = take.mul(lot.costPerTokenUsd);
    totalCostUsd = totalCostUsd.plus(costUsd);
    allocated = allocated.plus(take);
    const newRemaining = lotQty.minus(take);
    lotUpdates.push({ id: lot.id, newRemaining });
  }

  const averageCostPerTokenUsd =
    allocated.gt(0) && totalCostUsd.gte(0) ? totalCostUsd.div(allocated) : null;
  const totalValueUsd = amount.mul(pricePerTokenUsd);

  await prisma.$transaction(async (tx) => {
    for (const { id, newRemaining } of lotUpdates) {
      await tx.inventoryLot.update({
        where: { id },
        data: {
          remainingQuantity: newRemaining,
          status: newRemaining.lte(0) ? "DEPLETED" : "OPEN",
        },
      });
    }
    await tx.inventoryAsset.update({
      where: { id: asset.id },
      data: { currentBalance: newBalance },
    });
    await tx.inventoryLedger.create({
      data: {
        assetId: asset.id,
        type: "DISPOSED",
        quantity: amount.negated(),
        pricePerTokenUsd,
        totalValueUsd,
        referenceId: input.sourceTransactionId ?? "",
        counterparty: null,
      },
    });
  });

  const entry: BalanceEntry = {
    amount: newBalance.toString(),
    status: "updated",
    updatedAt: new Date().toISOString(),
  };
  await setBalance(input.chain, input.symbol, entry);

  if (input.sourceTransactionId) {
    await recordBalanceSnapshot(input.sourceTransactionId, asset.id, current, newBalance).catch(() => { });
  }
  return { averageCostPerTokenUsd, allocatedLots };
}

/**
 * Add to inventory (we receive token from user). Used when we receive f_token on BUY or f_token on SELL.
 * Creates a lot with USD cost basis for FIFO fulfillment and an ACQUIRED ledger entry.
 * costPerTokenUsd must be the USD price per token at acquisition (e.g. 1.0 for USDC, ~0.064 for GHS).
 */
export async function addInventory(input: InventoryAdditionInput): Promise<void> {
  const amount = toDecimal(input.amount);
  const sourceType = input.type ?? "PURCHASE";
  const chainId = input.chainId ?? chainToChainId(input.chain);
  const costPerTokenUsd = toDecimal(input.costPerTokenUsd);
  const totalCostUsd = amount.mul(costPerTokenUsd);

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
    prisma.inventoryLedger.create({
      data: {
        assetId: asset.id,
        type: "ACQUIRED",
        quantity: amount,
        pricePerTokenUsd: costPerTokenUsd,
        totalValueUsd: totalCostUsd,
        referenceId: input.sourceTransactionId ?? "",
        counterparty: null,
      },
    }),
    prisma.inventoryLot.create({
      data: {
        assetId: asset.id,
        originalQuantity: amount,
        remainingQuantity: amount,
        costPerTokenUsd,
        totalCostUsd,
        status: "OPEN",
        sourceType: sourceType,
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

  if (input.sourceTransactionId) {
    await recordBalanceSnapshot(input.sourceTransactionId, asset.id, current, newBalance).catch(() => { });
  }
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
    await setBalance(chain, symbol, entry, BALANCE_SYNC_TTL_SECONDS);
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
 * Volume-weighted average USD cost basis of available lots for an asset.
 * Use as floor in pricing so we never sell below cost. Returns null if no lots or total quantity is zero.
 */
export async function getAverageCostBasis(assetId: string): Promise<Decimal | null> {
  const lots = await prisma.inventoryLot.findMany({
    where: { assetId, status: "OPEN", remainingQuantity: { gt: 0 } },
    orderBy: { acquiredAt: "asc" },
  });
  if (lots.length === 0) return null;
  let totalQty = new Decimal(0);
  let totalCostUsd = new Decimal(0);
  for (const lot of lots) {
    const q = new Decimal(lot.remainingQuantity);
    totalQty = totalQty.plus(q);
    totalCostUsd = totalCostUsd.plus(q.mul(lot.costPerTokenUsd));
  }
  if (totalQty.lte(0)) return null;
  return totalCostUsd.div(totalQty);
}

/**
 * Volume-weighted average USD cost basis across all InventoryAssets with the same chain+symbol.
 * Used for validation cache. Returns null if no lots or total quantity is zero.
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
    where: { assetId: { in: assetIds }, status: "OPEN", remainingQuantity: { gt: 0 } },
  });
  if (lots.length === 0) return null;
  let totalQty = new Decimal(0);
  let totalCostUsd = new Decimal(0);
  for (const lot of lots) {
    const q = new Decimal(lot.remainingQuantity);
    totalQty = totalQty.plus(q);
    totalCostUsd = totalCostUsd.plus(q.mul(lot.costPerTokenUsd));
  }
  if (totalQty.lte(0)) return null;
  return totalCostUsd.div(totalQty);
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
      ...(options?.onlyAvailable === true ? { status: "OPEN", remainingQuantity: { gt: 0 } } : {}),
    },
    orderBy: { acquiredAt: "asc" },
  });
}
