import { Job } from "bullmq";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";
import { type PollJobData } from "../lib/queue.js";
import { deductInventory, addInventory } from "../services/inventory.service.js";
import { refreshCostBasisForChainToken } from "../services/validation-cache.service.js";
import { triggerTransactionStatusChange } from "../services/pusher.service.js";
import { computeTransactionFee, getFeeForOrder } from "../services/fee.service.js";
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
        const deductResult = await deductInventory({
          chain: tAsset.chain,
          chainId: tAsset.chainId,
          tokenAddress: tAsset.tokenAddress,
          symbol: tAsset.symbol,
          amount: tx.t_amount,
          address: tAsset.address,
          type: "SALE",
          providerQuotePrice: tx.t_price,
          sourceTransactionId: transactionId,
        });
        const sellingPrice = new Decimal(tx.t_price);
        const providerPrice = tx.providerPrice != null ? new Decimal(tx.providerPrice) : sellingPrice;
        if (deductResult.allocatedLots.length > 0) {
          await prisma.transactionPnL.createMany({
            data: deductResult.allocatedLots.map((lot) => {
              const qty = lot.quantity;
              const cost = lot.costPerToken;
              const feeAmount = qty.mul(sellingPrice.minus(providerPrice));
              const profitLoss = qty.mul(sellingPrice.minus(cost));
              return {
                transactionId,
                lotId: lot.lotId,
                quantity: qty,
                costPerToken: cost,
                providerPrice,
                sellingPrice,
                feeAmount,
                profitLoss,
              };
            }),
          });
        }
        await refreshCostBasisForChainToken(tChain, tx.t_token).catch(() => {});
      }
      const fAsset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.f_token, chain: fChain },
      });
      if (fAsset) {
        await addInventory({
          chain: fAsset.chain,
          chainId: fAsset.chainId,
          tokenAddress: fAsset.tokenAddress,
          symbol: fAsset.symbol,
          amount: tx.f_amount,
          address: fAsset.address,
          type: "PURCHASE",
          providerQuotePrice: tx.f_price,
          sourceTransactionId: transactionId,
        });
        await refreshCostBasisForChainToken(fChain, tx.f_token).catch(() => {});
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
          chainId: fAsset.chainId,
          tokenAddress: fAsset.tokenAddress,
          symbol: fAsset.symbol,
          amount: tx.f_amount,
          address: fAsset.address,
          type: "PURCHASE",
          providerQuotePrice: tx.f_price,
          sourceTransactionId: transactionId,
        });
        await refreshCostBasisForChainToken(fChain, tx.f_token).catch(() => {});
      }
      const tAsset = await prisma.inventoryAsset.findFirst({
        where: { symbol: tx.t_token, chain: tChain },
      });
      if (tAsset) {
        await deductInventory({
          chain: tAsset.chain,
          chainId: tAsset.chainId,
          tokenAddress: tAsset.tokenAddress,
          symbol: tAsset.symbol,
          amount: tx.t_amount,
          address: tAsset.address,
          type: "SALE",
          providerQuotePrice: tx.t_price,
          sourceTransactionId: transactionId,
        });
        await refreshCostBasisForChainToken(tChain, tx.t_token).catch(() => {});
      }
    }

    const feeAmount = computeTransactionFee(tx);

    const updateData: { status: "COMPLETED"; fee?: number } = { status: "COMPLETED" };
    if (Number.isFinite(feeAmount)) updateData.fee = feeAmount;
    await prisma.transaction.update({
      where: { id: transactionId },
      data: updateData,
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
        feeAmount: feeAmount,
        feePercent: feeQuote.feePercent,
        totalCost: feeQuote.totalCost,
        profit: feeAmount,
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
