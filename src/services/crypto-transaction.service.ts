/**
 * Crypto / swap transaction tracking: record and update swap executions (0x, Squid, LiFi).
 * Enables search by id or tx hash and linking to business Transaction for onramp/offramp.
 */

import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const PROVIDERS = ["0x", "squid", "lifi"] as const;
const STATUSES = ["PENDING", "SUBMITTED", "CONFIRMED", "FAILED"] as const;

export type CryptoTransactionProvider = (typeof PROVIDERS)[number];
export type CryptoTransactionStatusDb = (typeof STATUSES)[number];

export type CreateCryptoTransactionInput = {
  provider: CryptoTransactionProvider;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  transactionId?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateCryptoTransactionInput = {
  status?: CryptoTransactionStatusDb;
  txHash?: string;
  txUrl?: string;
  transactionId?: string;
  metadata?: Record<string, unknown>;
};

export async function createCryptoTransaction(
  input: CreateCryptoTransactionInput
): Promise<{ id: string }> {
  const row = await prisma.cryptoTransaction.create({
    data: {
      provider: input.provider,
      fromChainId: input.fromChainId,
      toChainId: input.toChainId,
      fromToken: input.fromToken,
      toToken: input.toToken,
      fromAmount: input.fromAmount,
      toAmount: input.toAmount,
      status: "PENDING",
      transactionId: input.transactionId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: { id: true },
  });
  return { id: row.id };
}

export async function updateCryptoTransaction(
  id: string,
  input: UpdateCryptoTransactionInput
): Promise<{ id: string } | null> {
  const row = await prisma.cryptoTransaction.updateMany({
    where: { id },
    data: {
      ...(input.status != null && { status: input.status }),
      ...(input.txHash != null && { txHash: input.txHash }),
      ...(input.txUrl != null && { txUrl: input.txUrl }),
      ...(input.transactionId != null && { transactionId: input.transactionId }),
      ...(input.metadata != null && { metadata: input.metadata as Prisma.InputJsonValue }),
    },
  });
  if (row.count === 0) return null;
  return { id };
}

export async function getCryptoTransactionById(id: string) {
  const row = await prisma.cryptoTransaction.findUnique({
    where: { id },
    include: {
      transaction: {
        select: {
          id: true,
          type: true,
          status: true,
          f_chain: true,
          t_chain: true,
          f_token: true,
          t_token: true,
        },
      },
    },
  });
  if (!row) return null;
  return serializeRow(row);
}

export async function getCryptoTransactionByTxHash(txHash: string) {
  const row = await prisma.cryptoTransaction.findFirst({
    where: { txHash: txHash.trim() },
    include: {
      transaction: {
        select: {
          id: true,
          type: true,
          status: true,
          f_chain: true,
          t_chain: true,
          f_token: true,
          t_token: true,
        },
      },
    },
  });
  if (!row) return null;
  return serializeRow(row);
}

export async function listCryptoTransactions(params: {
  page: number;
  limit: number;
  provider?: CryptoTransactionProvider;
  status?: CryptoTransactionStatusDb;
}) {
  const { page, limit, provider, status } = params;
  const skip = (page - 1) * limit;
  const where = {
    ...(provider && { provider }),
    ...(status && { status }),
  };
  const [items, total] = await Promise.all([
    prisma.cryptoTransaction.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        transaction: {
          select: { id: true, type: true, status: true },
        },
      },
    }),
    prisma.cryptoTransaction.count({ where }),
  ]);
  return {
    items: items.map(serializeRow),
    total,
    page,
    limit,
  };
}

function serializeRow(row: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  provider: string;
  status: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  txHash: string | null;
  txUrl: string | null;
  transactionId: string | null;
  metadata: unknown;
  transaction?: unknown;
}) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    provider: row.provider,
    status: row.status,
    fromChainId: row.fromChainId,
    toChainId: row.toChainId,
    fromToken: row.fromToken,
    toToken: row.toToken,
    fromAmount: row.fromAmount,
    toAmount: row.toAmount,
    txHash: row.txHash,
    txUrl: row.txUrl,
    transactionId: row.transactionId,
    metadata: row.metadata,
    transaction: row.transaction ?? undefined,
  };
}
