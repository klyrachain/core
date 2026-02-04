import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { type PollJobData } from "../lib/queue.js";
import { deductInventory, addInventory } from "../services/inventory.service.js";
import { refreshCostBasisForChainToken } from "../services/validation-cache.service.js";
import { triggerTransactionStatusChange } from "../services/pusher.service.js";
import { computeTransactionFee, getFeeForOrder } from "../services/fee.service.js";
import { feeInUsdFromAmount } from "../services/transaction-price.service.js";
import { sendToAdminDashboard } from "../services/admin-dashboard.service.js";
import type { TransactionStatus } from "../../prisma/generated/prisma/client.js";

function toNum(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseFloat(String(v)) || 0;
}

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
  const tTokenPriceUsd = toNum(tx.t_tokenPriceUsd);
  const fTokenPriceUsd = toNum(tx.f_tokenPriceUsd);
  const exchangeRateNum =
    toNum(tx.exchangeRate) > 0 ? toNum(tx.exchangeRate) : Number(tx.t_amount) / Number(tx.f_amount) || 0;
  const sellingPriceFromPerTo = exchangeRateNum > 0 ? 1 / exchangeRateNum : 0;

  try {
    // BUY: user gives f_token on f_chain, receives t_token on t_chain. We deduct t_token (give to user), add f_token (receive).
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
          pricePerTokenUsd: tTokenPriceUsd > 0 ? tTokenPriceUsd : 0,
          sourceTransactionId: transactionId,
        });
        const sellingPriceUsd = tTokenPriceUsd;
        const providerPrice = tx.providerPrice != null ? toNum(tx.providerPrice) : sellingPriceFromPerTo;
        if (deductResult.allocatedLots.length > 0 && sellingPriceUsd > 0) {
          await prisma.transactionPnL.createMany({
            data: deductResult.allocatedLots.map((lot) => {
              const qty = lot.quantity;
              const costUsd = Number(lot.costPerTokenUsd);
              const profitLossUsd = Number(qty.mul(sellingPriceUsd - costUsd));
              const spreadFrom = sellingPriceFromPerTo - providerPrice;
              const feeAmountUsd = Number(qty.mul(spreadFrom).mul(fTokenPriceUsd || 0));
              return {
                transactionId,
                lotId: lot.lotId,
                quantity: qty,
                costPerTokenUsd: lot.costPerTokenUsd,
                feeAmountUsd: Math.max(0, feeAmountUsd),
                profitLossUsd,
              };
            }),
          });
        }
        await refreshCostBasisForChainToken(tChain, tx.t_token).catch(() => { });
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
          costPerTokenUsd: fTokenPriceUsd > 0 ? fTokenPriceUsd : 1,
          sourceTransactionId: transactionId,
        });
        await refreshCostBasisForChainToken(fChain, tx.f_token).catch(() => { });
      }
    }

    // SELL: user gives f_token on f_chain, receives t_token on t_chain. We add f_token (receive), deduct t_token (give to user).
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
          costPerTokenUsd: fTokenPriceUsd > 0 ? fTokenPriceUsd : 1,
          sourceTransactionId: transactionId,
        });
        await refreshCostBasisForChainToken(fChain, tx.f_token).catch(() => { });
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
          pricePerTokenUsd: tTokenPriceUsd > 0 ? tTokenPriceUsd : 0,
          sourceTransactionId: transactionId,
        });
        await refreshCostBasisForChainToken(tChain, tx.t_token).catch(() => { });
      }
    }

    const feeAmount = computeTransactionFee(tx);
    const feeUsd = feeInUsdFromAmount(
      Number.isFinite(feeAmount) ? feeAmount : 0,
      tx.type,
      fTokenPriceUsd || null,
      tTokenPriceUsd || null
    );

    const updateData: {
      status: "COMPLETED";
      fee?: number;
      platformFee?: number;
      feeInUsd?: number;
    } = { status: "COMPLETED" };
    if (Number.isFinite(feeAmount)) {
      updateData.fee = feeAmount;
      updateData.platformFee = feeAmount;
    }
    if (Number.isFinite(feeUsd) && feeUsd > 0) {
      updateData.feeInUsd = feeUsd;
    }
    await prisma.transaction.update({
      where: { id: transactionId },
      data: updateData,
    });

    const feeQuote =
      tx.type !== "TRANSFER"
        ? getFeeForOrder({
          action: tx.type.toLowerCase() as "buy" | "sell" | "request" | "claim",
          f_amount: Number(tx.f_amount),
          t_amount: Number(tx.t_amount),
          f_price: fTokenPriceUsd > 0 ? 1 / fTokenPriceUsd : 0,
          t_price: tTokenPriceUsd > 0 ? 1 / tTokenPriceUsd : 0,
          f_token: tx.f_token,
          t_token: tx.t_token,
        })
        : {
          feePercent: 0,
          totalCost: Number(tx.f_amount),
          totalReceived: Number(tx.t_amount),
          rate: 0,
          grossValue: 0,
          profit: 0,
          feeAmount: 0,
        };
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
        f_tokenPriceUsd: fTokenPriceUsd,
        t_tokenPriceUsd: tTokenPriceUsd,
        f_token: tx.f_token,
        t_token: tx.t_token,
        feeAmount: feeAmount,
        feeInUsd: feeUsd,
        feePercent: feeQuote.feePercent,
        totalCost: feeQuote.totalCost,
        profit: feeAmount,
      },
    }).catch(() => { });

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
    }).catch(() => { });
    await triggerTransactionStatusChange({
      transactionId,
      status: "FAILED" as TransactionStatus,
      type: tx.type,
    });
    throw err;
  }
}
