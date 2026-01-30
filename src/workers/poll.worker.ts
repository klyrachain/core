import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { type PollJobData } from "../lib/queue.js";
import { deductInventory, addInventory } from "../services/inventory.service.js";
import { triggerTransactionStatusChange } from "../services/pusher.service.js";
import { getFeeForOrder } from "../services/fee.service.js";
import { sendToAdminDashboard } from "../services/admin-dashboard.service.js";
import type { TransactionStatus } from "../../prisma/generated/prisma/client.js";

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

  const fChain = tx.f_chain ?? "ETHEREUM";
  const tChain = tx.t_chain ?? "ETHEREUM";

  try {
    // BUY: user gives f_token on f_chain, receives t_token on t_chain. We deduct t_token on t_chain (give to user), add f_token on f_chain (receive).
    if (tx.type === "BUY") {
      const tAsset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.t_token, chain: tChain },
      });
      if (tAsset) {
        await deductInventory({
          chain: tAsset.chain,
          tokenAddress: tAsset.tokenAddress,
          symbol: tAsset.symbol,
          amount: tx.t_amount,
          type: "SALE",
          providerQuotePrice: tx.t_price,
        });
      }
      const fAsset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.f_token, chain: fChain },
      });
      if (fAsset) {
        await addInventory({
          chain: fAsset.chain,
          tokenAddress: fAsset.tokenAddress,
          symbol: fAsset.symbol,
          amount: tx.f_amount,
          type: "PURCHASE",
          providerQuotePrice: tx.f_price,
        });
      }
    }

    // SELL: user gives f_token on f_chain, receives t_token on t_chain. We add f_token on f_chain (receive), deduct t_token on t_chain (give to user).
    if (tx.type === "SELL") {
      const fAsset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.f_token, chain: fChain },
      });
      if (fAsset) {
        await addInventory({
          chain: fAsset.chain,
          tokenAddress: fAsset.tokenAddress,
          symbol: fAsset.symbol,
          amount: tx.f_amount,
          type: "PURCHASE",
          providerQuotePrice: tx.f_price,
        });
      }
      const tAsset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.t_token, chain: tChain },
      });
      if (tAsset) {
        await deductInventory({
          chain: tAsset.chain,
          tokenAddress: tAsset.tokenAddress,
          symbol: tAsset.symbol,
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

    const feeQuote = getFeeForOrder({
      action: tx.type.toLowerCase() as "buy" | "sell" | "request" | "claim",
      f_amount: Number(tx.f_amount),
      t_amount: Number(tx.t_amount),
      f_price: Number(tx.f_price),
      t_price: Number(tx.t_price),
      f_token: tx.f_token,
      t_token: tx.t_token,
    });
    await sendToAdminDashboard({
      event: "order.completed",
      data: {
        transactionId,
        status: "COMPLETED",
        type: tx.type,
        f_chain: fChain,
        t_chain: tChain,
        f_amount: Number(tx.f_amount),
        t_amount: Number(tx.t_amount),
        f_price: Number(tx.f_price),
        t_price: Number(tx.t_price),
        f_token: tx.f_token,
        t_token: tx.t_token,
        feeAmount: feeQuote.feeAmount,
        feePercent: feeQuote.feePercent,
        totalCost: feeQuote.totalCost,
        profit: feeQuote.profit,
      },
    }).catch(() => {});

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
    await sendToAdminDashboard({
      event: "order.failed",
      data: {
        transactionId,
        status: "FAILED",
        type: tx.type,
        f_chain: fChain,
        t_chain: tChain,
        f_token: tx.f_token,
        t_token: tx.t_token,
        error: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {});
    await triggerTransactionStatusChange({
      transactionId,
      status: "FAILED" as TransactionStatus,
      type: tx.type,
    });
    throw err;
  }
}
