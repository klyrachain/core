/**
 * Peer ramp matcher: same chainId + tokenAddress (lowercase), opposite sides, greedy largest-remainder-first.
 */

import type { PeerRampOrderSide, PeerRampOrderStatus } from "../../prisma/generated/prisma/client.js";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../lib/prisma.js";

export function normalizePeerRampTokenAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

function terminalStatus(status: PeerRampOrderStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "EXPIRED";
}

function nextStatus(remaining: Decimal): PeerRampOrderStatus {
  if (remaining.lte(0)) return "AWAITING_SETTLEMENT";
  return "PARTIALLY_FILLED";
}

/**
 * Match one order against the opposite book until its remainder is zero or no liquidity.
 * Each step pairs with the single largest resting counter-order (greedy).
 */
export async function tryMatchPeerRampOrder(orderId: string): Promise<{ fillsCreated: number }> {
  return prisma.$transaction(async (tx) => {
    let fills = 0;

    while (true) {
      const init = await tx.peerRampOrder.findUnique({
        where: { id: orderId },
      });
      if (!init || terminalStatus(init.status as PeerRampOrderStatus)) break;

      const initRem = new Decimal(init.cryptoAmountRemaining);
      if (initRem.lte(0)) break;

      const counterSide: PeerRampOrderSide = init.side === "ONRAMP" ? "OFFRAMP" : "ONRAMP";
      const tokenNorm = normalizePeerRampTokenAddress(init.tokenAddress);

      const best = await tx.peerRampOrder.findFirst({
        where: {
          side: counterSide,
          chainId: init.chainId,
          tokenAddress: tokenNorm,
          status: { in: ["OPEN", "PARTIALLY_FILLED"] },
          id: { not: init.id },
          cryptoAmountRemaining: { gt: new Decimal(0) },
        },
        orderBy: { cryptoAmountRemaining: "desc" },
      });

      if (!best) break;

      const peerRem = new Decimal(best.cryptoAmountRemaining);
      if (peerRem.lte(0)) break;

      const trade = initRem.lessThanOrEqualTo(peerRem) ? initRem : peerRem;
      if (trade.lte(0)) break;

      const onrampId = init.side === "ONRAMP" ? init.id : best.id;
      const offrampId = init.side === "ONRAMP" ? best.id : init.id;

      await tx.peerRampFill.create({
        data: {
          onrampOrderId: onrampId,
          offrampOrderId: offrampId,
          cryptoAmount: trade,
        },
      });
      fills += 1;

      const newInitRem = initRem.minus(trade);
      const newPeerRem = peerRem.minus(trade);

      await tx.peerRampOrder.update({
        where: { id: best.id },
        data: {
          cryptoAmountRemaining: newPeerRem,
          status: nextStatus(newPeerRem),
        },
      });

      await tx.peerRampOrder.update({
        where: { id: init.id },
        data: {
          cryptoAmountRemaining: newInitRem,
          status: nextStatus(newInitRem),
        },
      });
    }

    return { fillsCreated: fills };
  });
}

export async function matchPeerRampOrderAfterCreate(orderId: string): Promise<{ fillsCreated: number }> {
  return tryMatchPeerRampOrder(orderId);
}
