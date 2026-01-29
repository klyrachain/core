import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { type PollJobData } from "../lib/queue.js";
import { deductInventory } from "../services/inventory.service.js";
import { triggerTransactionStatusChange } from "../services/pusher.service.js";
import type { TransactionStatus } from "@prisma/client";

const DEFAULT_CHAIN = "ETHEREUM";

export async function processPollJob(job: Job<PollJobData>): Promise<void> {
  const { transactionId } = job.data;

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
  });

  if (!tx) {
    throw new Error(`Transaction not found: ${transactionId}`);
  }

  if (tx.status !== "PENDING") {
    return;
  }

  try {
    if (tx.type === "BUY") {
      const asset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.t_token, chain: DEFAULT_CHAIN },
      });
      if (asset) {
        await deductInventory({
          chain: asset.chain,
          tokenAddress: asset.tokenAddress,
          symbol: asset.symbol,
          amount: tx.t_amount,
          type: "SALE",
          providerQuotePrice: tx.t_price,
        });
      }
    }

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "COMPLETED" },
    });

    await triggerTransactionStatusChange({
      transactionId,
      status: "COMPLETED" as TransactionStatus,
      type: tx.type,
    });
  } catch (err) {
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "FAILED" },
    });
    await triggerTransactionStatusChange({
      transactionId,
      status: "FAILED" as TransactionStatus,
      type: tx.type,
    });
    throw err;
  }
}
